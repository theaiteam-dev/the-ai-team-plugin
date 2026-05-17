package cmd

// Tests for WI-006: tick recovery actions.
//
// Extends controller_tick (WI-004) with two new action kinds — release and
// move — plus a needsJudgment branch for ambiguous stalls. Each test function
// maps to one acceptance criterion of WI-006:
//
//	TestRecoveryEmitsReleaseForStaleClaim        → AC1
//	TestRecoveryEmitsMoveForBriefingsWithDepsDone → AC2
//	TestRecoveryEmitsNeedsJudgmentForAmbiguousStall → AC3
//	TestRecoveryActionIDsAndActivityLogWriteCitation → AC4
//	TestRecoveryIsIdempotentAfterConfirmation    → AC5
//
// All tests reuse the tickAPIMocks / runTick / withTempPoolRoot helpers
// from controller_tick_test.go (same package).

import (
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"time"
)

// ---------------------------------------------------------------------------
// Helpers for recovery tests: health-report response builder, in-flight item
// builder, recent-activity entry builders, pool slot setup.
// ---------------------------------------------------------------------------

// healthResponse builds the {success, data:{...}} envelope returned by
// GET /api/missions/current/health-report, wrapping an inFlightItems slice.
// Zero items models a clean idle mission.
func healthResponse(inFlightItems ...map[string]interface{}) []byte {
	items := make([]interface{}, 0, len(inFlightItems))
	for _, it := range inFlightItems {
		items = append(items, it)
	}
	return mustJSON(map[string]interface{}{
		"success": true,
		"data": map[string]interface{}{
			"missionId":     "M-test",
			"generatedAt":   time.Now().UTC().Format(time.RFC3339),
			"missionIdle":   false,
			"inFlightItems": items,
		},
	})
}

// recentHookEvent builds an entry in `inFlightItems[].recentActivity` whose
// origin is HookEvent (non-"activity" eventType, non-null tool). Used to model
// "a hook event recently fired for this item".
func recentHookEvent(agent, tool, eventType string, secondsAgo int) map[string]interface{} {
	return map[string]interface{}{
		"agent":     agent,
		"tool":      tool,
		"eventType": eventType,
		"timestamp": time.Now().Add(-time.Duration(secondsAgo) * time.Second).UTC().Format(time.RFC3339),
	}
}

// recentActivityLogEntry builds an entry in `inFlightItems[].recentActivity`
// whose origin is ActivityLog (eventType="activity", tool=null). Used to model
// "the agent wrote an activity log entry recently — but no hook events".
func recentActivityLogEntry(agent string, secondsAgo int) map[string]interface{} {
	return map[string]interface{}{
		"agent":     agent,
		"tool":      nil,
		"eventType": "activity",
		"timestamp": time.Now().Add(-time.Duration(secondsAgo) * time.Second).UTC().Format(time.RFC3339),
	}
}

// inFlightItem builds one entry of the inFlightItems array. claimedAt is set
// to idleSeconds+60s in the past so it precedes the most recent activity
// timestamp regardless of source.
func inFlightItem(itemID, agent, stage string, idleSeconds int, lastActivitySource string, recentActivity []map[string]interface{}) map[string]interface{} {
	recent := make([]interface{}, 0, len(recentActivity))
	for _, ra := range recentActivity {
		recent = append(recent, ra)
	}
	return map[string]interface{}{
		"itemId":             itemID,
		"title":              "Item " + itemID,
		"stage":              stage,
		"assignedAgent":      agent,
		"claimedAt":          time.Now().Add(-time.Duration(idleSeconds+60) * time.Second).UTC().Format(time.RFC3339),
		"lastActivityAt":     time.Now().Add(-time.Duration(idleSeconds) * time.Second).UTC().Format(time.RFC3339),
		"lastActivitySource": lastActivitySource,
		"idleSeconds":        idleSeconds,
		"lastWorkLogEntry":   nil,
		"recentActivity":     recent,
	}
}

// setupStaleIdleSlot creates poolDir/<instance>.idle and sets its mtime to
// `ageSeconds` in the past. ageSeconds > 600 satisfies the default
// ATEAM_STALE_CLAIM_SECONDS threshold.
func setupStaleIdleSlot(t *testing.T, poolDir, instance string, ageSeconds int) {
	t.Helper()
	if err := os.MkdirAll(poolDir, 0o755); err != nil {
		t.Fatalf("mkdir poolDir: %v", err)
	}
	idleFile := filepath.Join(poolDir, instance+".idle")
	if err := os.WriteFile(idleFile, nil, 0o644); err != nil {
		t.Fatalf("write idle file %s: %v", idleFile, err)
	}
	old := time.Now().Add(-time.Duration(ageSeconds) * time.Second)
	if err := os.Chtimes(idleFile, old, old); err != nil {
		t.Fatalf("chtimes idle file %s: %v", idleFile, err)
	}
}

// setupBusySlot creates poolDir/<instance>.busy. Used to model "agent slot is
// still busy (in its own opinion)" — the trigger for AC3's ambiguous stall.
func setupBusySlot(t *testing.T, poolDir, instance string) {
	t.Helper()
	if err := os.MkdirAll(poolDir, 0o755); err != nil {
		t.Fatalf("mkdir poolDir: %v", err)
	}
	busyFile := filepath.Join(poolDir, instance+".busy")
	if err := os.WriteFile(busyFile, nil, 0o644); err != nil {
		t.Fatalf("write busy file %s: %v", busyFile, err)
	}
}

// findActionForItem returns the first action in plan whose "kind" equals kind
// AND "itemId" equals itemID, or nil. Bridges the gap from
// findActionByKind (single-action lookup) to per-item queries — recovery tests
// often have multiple items in flight and need to assert on one specifically.
func findActionForItem(plan map[string]interface{}, kind, itemID string) map[string]interface{} {
	actions, _ := plan["actions"].([]interface{})
	for _, a := range actions {
		am, ok := a.(map[string]interface{})
		if !ok {
			continue
		}
		if am["kind"] == kind && am["itemId"] == itemID {
			return am
		}
	}
	return nil
}

// ===========================================================================
// AC 1 — Tick emits a release action when the agent's pool slot has been
// .idle for longer than the stale threshold AND no hook_event has fired for
// the item within that window. Both conditions required — neither alone.
// ===========================================================================

func TestRecoveryEmitsReleaseForStaleClaim(t *testing.T) {
	t.Run("emits release when pool slot .idle past threshold AND no hook events in window", func(t *testing.T) {
		m := newTickAPIMocks(t)
		missionID, poolDir := withTempPoolRoot(t, "release-positive")
		t.Setenv("CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS", "1")

		// Pool slot has been .idle 900s — well past the 600s default threshold.
		setupStaleIdleSlot(t, poolDir, "murdock-1", 900)

		// In-flight item with idleSeconds 900, lastActivitySource is "work_log"
		// and recentActivity is empty — no hook events in window.
		m.missionBody = missionResponse(missionID, "running", nil)
		m.itemsByStage["testing"] = itemsResponse(map[string]interface{}{
			"id":      "WI-020",
			"title":   "Stalled feature",
			"stageId": "testing",
			"type":    "feature",
		})
		m.healthBody = healthResponse(inFlightItem(
			"WI-020", "murdock-1", "testing", 900, "work_log", nil,
		))

		_, plan, err := runTick(t, m.server.URL, "--dry-run")
		if err != nil {
			t.Fatalf("tick failed: %v", err)
		}
		if findActionForItem(plan, "release", "WI-020") == nil {
			t.Errorf("expected a release action for WI-020 when pool stale + no hook events in window; plan: %v", plan)
		}
	})

	t.Run("does NOT emit release when the agent's pool slot is .busy", func(t *testing.T) {
		m := newTickAPIMocks(t)
		missionID, poolDir := withTempPoolRoot(t, "release-negative-busy")
		t.Setenv("CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS", "1")

		// Pool slot is .busy — agent has not released its claim. The stale-claim
		// rule does not apply, no matter how quiet the activity log is.
		setupBusySlot(t, poolDir, "murdock-1")

		m.missionBody = missionResponse(missionID, "running", nil)
		m.itemsByStage["testing"] = itemsResponse(map[string]interface{}{
			"id": "WI-020", "title": "x", "stageId": "testing", "type": "feature",
		})
		m.healthBody = healthResponse(inFlightItem(
			"WI-020", "murdock-1", "testing", 900, "work_log", nil,
		))

		_, plan, err := runTick(t, m.server.URL, "--dry-run")
		if err != nil {
			t.Fatalf("tick failed: %v", err)
		}
		if findActionForItem(plan, "release", "WI-020") != nil {
			t.Errorf("release must NOT be emitted while the pool slot is .busy; plan: %v", plan)
		}
	})

	t.Run("does NOT emit release when pool .idle but NOT yet past threshold", func(t *testing.T) {
		m := newTickAPIMocks(t)
		missionID, poolDir := withTempPoolRoot(t, "release-negative-young-idle")
		t.Setenv("CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS", "1")

		// .idle for 120s — well below the 600s default threshold.
		setupStaleIdleSlot(t, poolDir, "murdock-1", 120)

		m.missionBody = missionResponse(missionID, "running", nil)
		m.itemsByStage["testing"] = itemsResponse(map[string]interface{}{
			"id": "WI-020", "title": "x", "stageId": "testing", "type": "feature",
		})
		m.healthBody = healthResponse(inFlightItem(
			"WI-020", "murdock-1", "testing", 120, "work_log", nil,
		))

		_, plan, err := runTick(t, m.server.URL, "--dry-run")
		if err != nil {
			t.Fatalf("tick failed: %v", err)
		}
		if findActionForItem(plan, "release", "WI-020") != nil {
			t.Errorf("release must NOT be emitted before the stale threshold elapses; plan: %v", plan)
		}
	})

	t.Run("does NOT emit release when pool stale BUT a hook event fired in window (both-conditions check)", func(t *testing.T) {
		m := newTickAPIMocks(t)
		missionID, poolDir := withTempPoolRoot(t, "release-negative-recent-hook")
		t.Setenv("CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS", "1")

		// Pool .idle for 900s, BUT a PostToolUse hook event fired 30s ago.
		// AC1 requires BOTH conditions; one out → no release.
		setupStaleIdleSlot(t, poolDir, "murdock-1", 900)

		m.missionBody = missionResponse(missionID, "running", nil)
		m.itemsByStage["testing"] = itemsResponse(map[string]interface{}{
			"id": "WI-020", "title": "x", "stageId": "testing", "type": "feature",
		})
		// idleSeconds reflects the freshest signal — the hook event 30s ago.
		// lastActivitySource = "hook_event" reinforces the recent-event signal.
		m.healthBody = healthResponse(inFlightItem(
			"WI-020", "murdock-1", "testing", 30, "hook_event",
			[]map[string]interface{}{recentHookEvent("murdock-1", "Bash", "PostToolUse", 30)},
		))

		_, plan, err := runTick(t, m.server.URL, "--dry-run")
		if err != nil {
			t.Fatalf("tick failed: %v", err)
		}
		if findActionForItem(plan, "release", "WI-020") != nil {
			t.Errorf("release requires BOTH stale pool AND no hook events in window; recent hook event present, must NOT emit; plan: %v", plan)
		}
	})
}

// ===========================================================================
// AC 2 — move actions are emitted ONLY for items in 'briefings' whose
// dependencies are all in 'done' (per /api/deps/check). Never emit move
// for backward transitions (e.g. probing → ready). Move is fully
// deterministic: toStage = 'ready' when deps satisfied.
// ===========================================================================

func TestRecoveryEmitsMoveForBriefingsWithDepsDone(t *testing.T) {
	t.Run("emits move with toStage='ready' for briefings item whose deps are done", func(t *testing.T) {
		m := newTickAPIMocks(t)
		missionID, _ := withTempPoolRoot(t, "move-positive")
		t.Setenv("CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS", "1")

		m.missionBody = missionResponse(missionID, "running", nil)
		m.itemsByStage["briefings"] = itemsResponse(map[string]interface{}{
			"id":      "WI-030",
			"title":   "Newly ready feature",
			"stageId": "briefings",
			"type":    "feature",
		})
		// deps-check reports WI-030 is now ready (all deps in done).
		m.depsBody = depsReadyResponse("WI-030")

		_, plan, err := runTick(t, m.server.URL, "--dry-run")
		if err != nil {
			t.Fatalf("tick failed: %v", err)
		}
		action := findActionForItem(plan, "move", "WI-030")
		if action == nil {
			t.Fatalf("expected a move action for briefings item WI-030 with deps done; plan: %v", plan)
		}
		// AC2 fixes toStage='ready' — move is fully deterministic.
		if toStage, _ := action["toStage"].(string); toStage != "ready" {
			t.Errorf("move action must set toStage='ready', got %q (full action: %v)", toStage, action)
		}
	})

	t.Run("does NOT emit move when briefings item has unmet dependencies", func(t *testing.T) {
		m := newTickAPIMocks(t)
		missionID, _ := withTempPoolRoot(t, "move-negative-deps")
		t.Setenv("CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS", "1")

		m.missionBody = missionResponse(missionID, "running", nil)
		m.itemsByStage["briefings"] = itemsResponse(map[string]interface{}{
			"id":      "WI-031",
			"title":   "Blocked feature",
			"stageId": "briefings",
			"type":    "feature",
		})
		// deps-check reports NOBODY is ready — WI-031 still has unmet deps.
		m.depsBody = depsReadyResponse()

		_, plan, err := runTick(t, m.server.URL, "--dry-run")
		if err != nil {
			t.Fatalf("tick failed: %v", err)
		}
		if findActionForItem(plan, "move", "WI-031") != nil {
			t.Errorf("move must NOT be emitted while deps are unmet; plan: %v", plan)
		}
	})

	t.Run("does NOT emit move for items already past 'briefings'", func(t *testing.T) {
		m := newTickAPIMocks(t)
		missionID, _ := withTempPoolRoot(t, "move-negative-ready")
		t.Setenv("CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS", "1")

		m.missionBody = missionResponse(missionID, "running", nil)
		// The item is already in 'ready'. deps-check still lists it as ready
		// (the deps API doesn't filter by stage) — but no move action is needed
		// because the item is already past briefings.
		m.itemsByStage["ready"] = itemsResponse(map[string]interface{}{
			"id": "WI-032", "title": "x", "stageId": "ready", "type": "feature",
		})
		m.depsBody = depsReadyResponse("WI-032")

		_, plan, err := runTick(t, m.server.URL, "--dry-run")
		if err != nil {
			t.Fatalf("tick failed: %v", err)
		}
		if findActionForItem(plan, "move", "WI-032") != nil {
			t.Errorf("move must NOT be re-emitted for items already past 'briefings'; plan: %v", plan)
		}
	})

	t.Run("does NOT emit move that would walk an item backward (probing → ready)", func(t *testing.T) {
		m := newTickAPIMocks(t)
		missionID, _ := withTempPoolRoot(t, "move-negative-backward")
		t.Setenv("CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS", "1")

		m.missionBody = missionResponse(missionID, "running", nil)
		// An item is in 'probing'. Even if deps-check somehow reports it as
		// ready, the controller must NEVER emit a move that walks it backward
		// — AC2 labels backward transitions as needsJudgment, not move.
		m.itemsByStage["probing"] = itemsResponse(map[string]interface{}{
			"id": "WI-033", "title": "x", "stageId": "probing", "type": "feature",
		})
		m.depsBody = depsReadyResponse("WI-033")

		_, plan, err := runTick(t, m.server.URL, "--dry-run")
		if err != nil {
			t.Fatalf("tick failed: %v", err)
		}
		if findActionForItem(plan, "move", "WI-033") != nil {
			t.Errorf("move must NEVER walk an item backward from a later stage; plan: %v", plan)
		}
	})
}

// ===========================================================================
// AC 3 — When the stall signals contradict (busy pool slot + no hook events
// + recent activity-log entry), tick emits needsJudgment naming the itemId,
// the conflicting signals, and a suggested investigation step — AND emits
// NO release/move action for that item in the same tick.
// ===========================================================================

func TestRecoveryEmitsNeedsJudgmentForAmbiguousStall(t *testing.T) {
	t.Run("emits stall-ambiguous needsJudgment with itemId, signals, and suggested investigation", func(t *testing.T) {
		m := newTickAPIMocks(t)
		missionID, poolDir := withTempPoolRoot(t, "ambiguous")
		t.Setenv("CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS", "1")

		// Mixed signals: pool .busy + a recent activity-log entry + no hook events.
		setupBusySlot(t, poolDir, "murdock-1")

		m.missionBody = missionResponse(missionID, "running", nil)
		m.itemsByStage["testing"] = itemsResponse(map[string]interface{}{
			"id":      "WI-040",
			"title":   "Ambiguously stalled",
			"stageId": "testing",
			"type":    "feature",
		})
		m.healthBody = healthResponse(inFlightItem(
			"WI-040", "murdock-1", "testing", 60, "activity_log",
			[]map[string]interface{}{recentActivityLogEntry("murdock-1", 60)},
		))

		_, plan, err := runTick(t, m.server.URL, "--dry-run")
		if err != nil {
			t.Fatalf("tick failed: %v", err)
		}

		nj, ok := plan["needsJudgment"].(map[string]interface{})
		if !ok || nj == nil {
			t.Fatalf("expected needsJudgment object for an ambiguous stall; got %T (%v)", plan["needsJudgment"], plan["needsJudgment"])
		}
		// Must extend the WI-004 envelope with kind:'stall-ambiguous'.
		if kind, _ := nj["kind"].(string); kind != "stall-ambiguous" {
			t.Errorf("needsJudgment.kind must be 'stall-ambiguous', got %q (payload: %v)", kind, nj)
		}
		// Must name the itemId.
		if id, _ := nj["itemId"].(string); id != "WI-040" {
			t.Errorf("needsJudgment.itemId must be 'WI-040', got %q (payload: %v)", id, nj)
		}
		// Must include a 'signals' object describing the contradictions.
		if _, ok := nj["signals"].(map[string]interface{}); !ok {
			t.Errorf("needsJudgment.signals must be an object naming the contradictions; payload: %v", nj)
		}
		// Must include a suggested next investigation step as
		// 'suggestedInvestigation' — pin the exact field name so the AC's
		// "naming … a suggested next investigation step" requirement is a
		// stable contract (Hannibal reads this payload by key).
		if s, _ := nj["suggestedInvestigation"].(string); s == "" {
			t.Errorf("needsJudgment must include a non-empty string field 'suggestedInvestigation' (the AC's 'suggested next investigation step'); payload: %v", nj)
		}
	})

	t.Run("ambiguous stall does NOT emit release or move for the same item in the same tick", func(t *testing.T) {
		m := newTickAPIMocks(t)
		missionID, poolDir := withTempPoolRoot(t, "ambiguous-no-recovery")
		t.Setenv("CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS", "1")

		setupBusySlot(t, poolDir, "murdock-1")
		m.missionBody = missionResponse(missionID, "running", nil)
		m.itemsByStage["testing"] = itemsResponse(map[string]interface{}{
			"id": "WI-040", "title": "x", "stageId": "testing", "type": "feature",
		})
		m.healthBody = healthResponse(inFlightItem(
			"WI-040", "murdock-1", "testing", 60, "activity_log",
			[]map[string]interface{}{recentActivityLogEntry("murdock-1", 60)},
		))

		_, plan, err := runTick(t, m.server.URL, "--dry-run")
		if err != nil {
			t.Fatalf("tick failed: %v", err)
		}
		if findActionForItem(plan, "release", "WI-040") != nil {
			t.Errorf("must NOT emit release when item is already flagged as needsJudgment in same tick; plan: %v", plan)
		}
		if findActionForItem(plan, "move", "WI-040") != nil {
			t.Errorf("must NOT emit move when item is already flagged as needsJudgment in same tick; plan: %v", plan)
		}
	})
}

// ===========================================================================
// AC 4 — release and move actions carry the same deterministic id shape as
// dispatch actions and are written to ActivityLog with a 'why' rationale
// citing the specific signals that triggered them.
// ===========================================================================

func TestRecoveryActionIDsAndActivityLogWriteCitation(t *testing.T) {
	t.Run("release action id matches <missionId>:<itemId>:release:<agent>:<seq>", func(t *testing.T) {
		m := newTickAPIMocks(t)
		missionID, poolDir := withTempPoolRoot(t, "release-id-shape")
		t.Setenv("CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS", "1")

		setupStaleIdleSlot(t, poolDir, "murdock-1", 900)
		m.missionBody = missionResponse(missionID, "running", nil)
		m.itemsByStage["testing"] = itemsResponse(map[string]interface{}{
			"id": "WI-050", "title": "x", "stageId": "testing", "type": "feature",
		})
		m.healthBody = healthResponse(inFlightItem(
			"WI-050", "murdock-1", "testing", 900, "work_log", nil,
		))

		_, plan, err := runTick(t, m.server.URL, "--dry-run")
		if err != nil {
			t.Fatalf("tick failed: %v", err)
		}
		action := findActionForItem(plan, "release", "WI-050")
		if action == nil {
			t.Fatalf("expected release action for WI-050; plan: %v", plan)
		}
		id, _ := action["id"].(string)
		idPattern := regexp.MustCompile(`^` + regexp.QuoteMeta(missionID) + `:WI-050:release:[^:]+:\d+$`)
		if !idPattern.MatchString(id) {
			t.Errorf("release id %q does not match <missionId>:<itemId>:release:<agent>:<seq>", id)
		}
	})

	t.Run("move action id matches <missionId>:<itemId>:move:<agent>:<seq>", func(t *testing.T) {
		m := newTickAPIMocks(t)
		missionID, _ := withTempPoolRoot(t, "move-id-shape")
		t.Setenv("CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS", "1")

		m.missionBody = missionResponse(missionID, "running", nil)
		m.itemsByStage["briefings"] = itemsResponse(map[string]interface{}{
			"id": "WI-051", "title": "x", "stageId": "briefings", "type": "feature",
		})
		m.depsBody = depsReadyResponse("WI-051")

		_, plan, err := runTick(t, m.server.URL, "--dry-run")
		if err != nil {
			t.Fatalf("tick failed: %v", err)
		}
		action := findActionForItem(plan, "move", "WI-051")
		if action == nil {
			t.Fatalf("expected move action for WI-051; plan: %v", plan)
		}
		id, _ := action["id"].(string)
		idPattern := regexp.MustCompile(`^` + regexp.QuoteMeta(missionID) + `:WI-051:move:[^:]+:\d+$`)
		if !idPattern.MatchString(id) {
			t.Errorf("move id %q does not match <missionId>:<itemId>:move:<agent>:<seq>", id)
		}
	})

	t.Run("non-dry-run: release's 'why' rationale is appended to ActivityLog", func(t *testing.T) {
		m := newTickAPIMocks(t)
		missionID, poolDir := withTempPoolRoot(t, "release-activity-log")
		t.Setenv("CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS", "1")

		setupStaleIdleSlot(t, poolDir, "murdock-1", 900)
		m.missionBody = missionResponse(missionID, "running", nil)
		m.itemsByStage["testing"] = itemsResponse(map[string]interface{}{
			"id": "WI-052", "title": "x", "stageId": "testing", "type": "feature",
		})
		m.healthBody = healthResponse(inFlightItem(
			"WI-052", "murdock-1", "testing", 900, "work_log", nil,
		))

		_, plan, err := runTick(t, m.server.URL) // no --dry-run → writes occur
		if err != nil {
			t.Fatalf("tick failed: %v", err)
		}
		action := findActionForItem(plan, "release", "WI-052")
		if action == nil {
			t.Fatalf("expected release action for WI-052; plan: %v", plan)
		}
		why, _ := action["why"].(string)
		if why == "" {
			t.Fatalf("release action must carry a non-empty 'why'; got %v", action)
		}

		posts := m.postsTo("/api/activity")
		var sawWhy bool
		for _, p := range posts {
			msg, _ := p["message"].(string)
			if strings.Contains(msg, why) {
				sawWhy = true
				break
			}
		}
		if !sawWhy {
			t.Errorf("expected an activity-log entry containing the release 'why' (%q); posts were: %v", why, posts)
		}
	})

	t.Run("non-dry-run: move's 'why' rationale is appended to ActivityLog", func(t *testing.T) {
		m := newTickAPIMocks(t)
		missionID, _ := withTempPoolRoot(t, "move-activity-log")
		t.Setenv("CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS", "1")

		m.missionBody = missionResponse(missionID, "running", nil)
		m.itemsByStage["briefings"] = itemsResponse(map[string]interface{}{
			"id": "WI-053", "title": "x", "stageId": "briefings", "type": "feature",
		})
		m.depsBody = depsReadyResponse("WI-053")

		_, plan, err := runTick(t, m.server.URL) // no --dry-run → writes occur
		if err != nil {
			t.Fatalf("tick failed: %v", err)
		}
		action := findActionForItem(plan, "move", "WI-053")
		if action == nil {
			t.Fatalf("expected move action for WI-053; plan: %v", plan)
		}
		why, _ := action["why"].(string)
		if why == "" {
			t.Fatalf("move action must carry a non-empty 'why'; got %v", action)
		}

		posts := m.postsTo("/api/activity")
		var sawWhy bool
		for _, p := range posts {
			msg, _ := p["message"].(string)
			if strings.Contains(msg, why) {
				sawWhy = true
				break
			}
		}
		if !sawWhy {
			t.Errorf("expected an activity-log entry containing the move 'why' (%q); posts were: %v", why, posts)
		}
	})
}

// ===========================================================================
// AC 5 — Idempotency: re-running tick after a release is recorded in
// checkpoint.confirmedActionIds does NOT re-emit a release for that same
// item — even if the underlying state (stale pool slot) has not yet updated.
// ===========================================================================

func TestRecoveryIsIdempotentAfterConfirmation(t *testing.T) {
	m := newTickAPIMocks(t)
	missionID, poolDir := withTempPoolRoot(t, "idempotent")
	t.Setenv("CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS", "1")

	// State: pool slot has been .idle 900s + item has no recent hook events.
	// AC1 conditions are satisfied — the first tick MUST emit a release.
	setupStaleIdleSlot(t, poolDir, "murdock-1", 900)
	m.missionBody = missionResponse(missionID, "running", nil)
	m.itemsByStage["testing"] = itemsResponse(map[string]interface{}{
		"id": "WI-060", "title": "x", "stageId": "testing", "type": "feature",
	})
	m.healthBody = healthResponse(inFlightItem(
		"WI-060", "murdock-1", "testing", 900, "work_log", nil,
	))

	// ── First tick — emits a release action with some deterministic id ────────
	_, plan1, err := runTick(t, m.server.URL, "--dry-run")
	if err != nil {
		t.Fatalf("first tick failed: %v", err)
	}
	action1 := findActionForItem(plan1, "release", "WI-060")
	if action1 == nil {
		t.Fatalf("first tick must emit a release for WI-060 (AC1 conditions met); plan: %v", plan1)
	}
	releaseID, _ := action1["id"].(string)
	if releaseID == "" {
		t.Fatalf("first release action is missing an id; action: %v", action1)
	}

	// ── Seed the checkpoint mock so the next tick sees the release as confirmed
	m.checkpointBody = mustJSON(map[string]interface{}{
		"success": true,
		"data": map[string]interface{}{
			"tickedAt":           time.Now().UTC().Format(time.RFC3339),
			"activityCursor":     0,
			"pendingActionIds":   []string{},
			"confirmedActionIds": []string{releaseID},
			"retryCounters":      map[string]interface{}{},
			"lastLaneState":      map[string]interface{}{},
		},
	})
	m.checkpointStatus = http.StatusOK

	// Underlying state is UNCHANGED — pool still stale, item still in-flight.
	// The only thing that changed is that the prior release is now confirmed.

	// ── Second tick — must NOT re-emit a release for WI-060 ───────────────────
	_, plan2, err := runTick(t, m.server.URL, "--dry-run")
	if err != nil {
		t.Fatalf("second tick failed: %v", err)
	}
	if findActionForItem(plan2, "release", "WI-060") != nil {
		t.Errorf("second tick must NOT re-emit release for WI-060 once a prior release id (%q) is in confirmedActionIds — idempotency violated; plan: %v", releaseID, plan2)
	}
}
