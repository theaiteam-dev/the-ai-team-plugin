package cmd

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// TestPoolVerbsRejectTraversalMissionID asserts that EVERY pool verb
// validates $ATEAM_MISSION_ID before touching the filesystem. Without this
// guard, ATEAM_MISSION_ID="../../etc" would yield poolDir="/etc" and
// 'pool destroy' would call os.RemoveAll on it.
func TestPoolVerbsRejectTraversalMissionID(t *testing.T) {
	verbs := []struct {
		name string
		argv []string
	}{
		{"init", []string{"pool", "init"}},
		{"destroy", []string{"pool", "destroy"}},
		{"status", []string{"pool", "status"}},
		{"claim", []string{"pool", "claim", "murdock-1"}},
		{"release", []string{"pool", "release", "murdock-1"}},
		{"mark-idle", []string{"pool", "mark-idle", "murdock-1"}},
	}

	badIDs := []struct {
		label string
		id    string
	}{
		{"empty", ""},
		{"dotdot-prefix", "../foo"},
		{"slash-segment", "foo/bar"},
		{"backslash-traversal", "foo\\..\\bar"},
		// NOTE: NUL bytes are rejected by the OS at setenv — they can't
		// reach the verb via $ATEAM_MISSION_ID. validateMissionID's NUL
		// rejection is covered by the unit test in pool_validate_test.go.
		{"only-dotdot", ".."},
		{"absolute-path", "/etc"},
		{"single-dot", "."},
	}

	// Sentinel path that the verbs would touch if validation were bypassed —
	// /etc is a useful canary because most CIs have it. We only need to assert
	// it is NOT removed/created; the verb must reject before reaching it.
	const canary = "/etc"
	canaryInfoBefore, canaryStatErr := os.Stat(canary)
	if canaryStatErr != nil {
		t.Skipf("cannot stat canary %s: %v", canary, canaryStatErr)
	}

	for _, v := range verbs {
		for _, b := range badIDs {
			t.Run(v.name+"/"+b.label, func(t *testing.T) {
				t.Setenv("ATEAM_MISSION_ID", b.id)

				out, err := runPoolCmd(t, v.argv...)
				if err == nil {
					t.Fatalf("expected error for %s with mission ID %q, got output: %s",
						v.name, b.id, out)
				}
				// The error MUST mention either ATEAM_MISSION_ID or one of the
				// rejection reasons — that is the human-actionable signal.
				combined := err.Error() + out
				if !strings.Contains(combined, "ATEAM_MISSION_ID") &&
					!strings.Contains(combined, "traversal") &&
					!strings.Contains(combined, "must match") &&
					!strings.Contains(combined, "separator") &&
					!strings.Contains(combined, "NUL") {
					t.Errorf("expected validation error message, got: %v / %s", err, out)
				}

				// And the canary must not have been touched.
				canaryInfoAfter, statErr := os.Stat(canary)
				if statErr != nil {
					t.Errorf("canary %s vanished after %s with id %q — validation bypassed!",
						canary, v.name, b.id)
				}
				if canaryInfoBefore.ModTime() != canaryInfoAfter.ModTime() {
					t.Errorf("canary %s mtime changed — validation bypassed for %s/%q",
						canary, v.name, b.id)
				}
			})
		}
	}
}

// TestPoolDestroyRefusesAbsoluteTraversalPath is a paranoia test: even if
// validateMissionID had a regression that allowed `..`, the destroy verb
// MUST NOT remove a path outside /tmp/.ateam-pool. We simulate this by
// creating a sentinel file under a unique prefix and proving destroy doesn't
// touch it when the ID is bogus.
func TestPoolDestroyRefusesAbsoluteTraversalPath(t *testing.T) {
	// Drop a sentinel inside the temp-poolroot location that a malicious ID
	// might reach.
	tmp := t.TempDir()
	sentinel := filepath.Join(tmp, "DO_NOT_DELETE.txt")
	if err := os.WriteFile(sentinel, []byte("keepme"), 0644); err != nil {
		t.Fatalf("seed sentinel: %v", err)
	}

	// Use an obviously-malicious ID. Validation must reject before any FS op.
	t.Setenv("ATEAM_MISSION_ID", "../"+filepath.Base(tmp))

	_, err := runPoolCmd(t, "pool", "destroy")
	if err == nil {
		t.Fatalf("expected destroy to reject traversal mission ID")
	}
	if _, statErr := os.Stat(sentinel); statErr != nil {
		t.Fatalf("sentinel %s was removed despite traversal — validation bypassed: %v",
			sentinel, statErr)
	}
}
