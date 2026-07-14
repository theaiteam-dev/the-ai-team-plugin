package cmd

import (
	"os"
	"path/filepath"
	"testing"
)

// TestClaimIdleInstanceMissingPoolDir verifies that a missing pool directory
// returns "" and writes a POOL_WARN to stderr — rather than silently returning
// "no idle instance available" (which is indistinguishable from a full pool).
// Issue #7a: /tmp/.ateam-pool is cleared on reboot, so this must be visible.
func TestClaimIdleInstanceMissingPoolDir(t *testing.T) {
	// Redirect stderr to capture the warning.
	origStderr := os.Stderr
	r, w, err := os.Pipe()
	if err != nil {
		t.Fatalf("os.Pipe: %v", err)
	}
	os.Stderr = w
	t.Cleanup(func() {
		os.Stderr = origStderr
	})

	missing := filepath.Join(t.TempDir(), "does-not-exist")
	got, gotID := claimIdleInstance(missing, "murdock")
	w.Close()
	buf := make([]byte, 4096)
	n, _ := r.Read(buf)
	stderr := string(buf[:n])

	if got != "" || gotID != "" {
		t.Errorf("expected empty instance and agentId when pool dir is missing, got %q/%q", got, gotID)
	}
	if !containsAll(stderr, []string{"POOL_WARN", missing, "does not exist"}) {
		t.Errorf("expected POOL_WARN with path and explanation in stderr, got: %s", stderr)
	}
}

// TestClaimIdleInstanceHappyPath verifies that with a pool dir containing an
// idle file, claimIdleInstance renames it to .busy and returns the instance name.
// An empty marker (no --agent-id was passed at mark-idle) yields an empty agentId,
// preserving the pre-existing name-only handoff behavior.
func TestClaimIdleInstanceHappyPath(t *testing.T) {
	poolDir := t.TempDir()
	idleFile := filepath.Join(poolDir, "murdock-1.idle")
	if err := os.WriteFile(idleFile, nil, 0644); err != nil {
		t.Fatalf("writing idle file: %v", err)
	}

	got, gotID := claimIdleInstance(poolDir, "murdock")
	if got != "murdock-1" {
		t.Errorf("expected claim of 'murdock-1', got %q", got)
	}
	if gotID != "" {
		t.Errorf("expected empty agentId for an empty marker, got %q", gotID)
	}

	// .idle must have been renamed to .busy
	if _, err := os.Stat(idleFile); !os.IsNotExist(err) {
		t.Errorf("expected %s to have been renamed away, stat err=%v", idleFile, err)
	}
	busyFile := filepath.Join(poolDir, "murdock-1.busy")
	if _, err := os.Stat(busyFile); err != nil {
		t.Errorf("expected %s to exist, stat err=%v", busyFile, err)
	}
}

// TestClaimIdleInstanceReturnsAgentID verifies that when the idle marker holds an
// agentId (written by 'pool mark-idle --agent-id'), claimIdleInstance reads it
// back and returns it alongside the instance name — the mechanism that lets the
// completing agent address its START handoff by agentId (name-addressing does not
// route between teammates in headless -p mode).
func TestClaimIdleInstanceReturnsAgentID(t *testing.T) {
	poolDir := t.TempDir()
	idleFile := filepath.Join(poolDir, "ba-2.idle")
	// Trailing newline to confirm the reader trims whitespace.
	if err := os.WriteFile(idleFile, []byte("a729de7264069a126\n"), 0644); err != nil {
		t.Fatalf("writing idle file: %v", err)
	}

	got, gotID := claimIdleInstance(poolDir, "ba")
	if got != "ba-2" {
		t.Errorf("expected claim of 'ba-2', got %q", got)
	}
	if gotID != "a729de7264069a126" {
		t.Errorf("expected agentId 'a729de7264069a126' read from the marker, got %q", gotID)
	}

	// The agentId must survive the .idle → .busy rename (content is preserved).
	busyFile := filepath.Join(poolDir, "ba-2.busy")
	content, err := os.ReadFile(busyFile)
	if err != nil {
		t.Fatalf("reading busy file: %v", err)
	}
	if got := string(content); got != "a729de7264069a126\n" {
		t.Errorf("expected .busy to retain the agentId content, got %q", got)
	}
}

// TestClaimIdleInstanceEmptyPoolDir verifies that an existing pool dir with no
// idle files returns "" cleanly (no error, no stderr noise). Sanity check for
// issue #8 — the glob happy path.
func TestClaimIdleInstanceEmptyPoolDir(t *testing.T) {
	poolDir := t.TempDir() // exists, but empty

	origStderr := os.Stderr
	r, w, err := os.Pipe()
	if err != nil {
		t.Fatalf("os.Pipe: %v", err)
	}
	os.Stderr = w
	t.Cleanup(func() {
		os.Stderr = origStderr
	})

	got, gotID := claimIdleInstance(poolDir, "murdock")
	w.Close()
	buf := make([]byte, 4096)
	n, _ := r.Read(buf)
	stderr := string(buf[:n])

	if got != "" || gotID != "" {
		t.Errorf("expected empty claim for empty pool dir, got %q/%q", got, gotID)
	}
	if stderr != "" {
		t.Errorf("expected no stderr output, got: %s", stderr)
	}
}

// TestClaimIdleInstanceIgnoresTempMarkers verifies that an in-flight/leftover
// atomic-publish temp file (<instance>.idle.*.tmp) is NOT claimable — its ".tmp"
// suffix must keep it out of the "*.idle" glob, so a claim never renames+reads a
// half-written marker.
func TestClaimIdleInstanceIgnoresTempMarkers(t *testing.T) {
	poolDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(poolDir, "ba-1.idle.1234.tmp"), []byte("partial"), 0644); err != nil {
		t.Fatalf("writing temp marker: %v", err)
	}

	got, gotID := claimIdleInstance(poolDir, "ba")
	if got != "" || gotID != "" {
		t.Errorf("expected temp marker to be unclaimable, got %q/%q", got, gotID)
	}
	// The temp file must be left untouched (not renamed to .busy).
	if _, err := os.Stat(filepath.Join(poolDir, "ba-1.idle.1234.tmp")); err != nil {
		t.Errorf("expected temp marker to remain untouched, stat err=%v", err)
	}
}

// TestPoolSelfReleaseEmptyAgent verifies that poolSelfRelease is a no-op when
// given an empty agent name — without this guard, the --body code path could
// pass "" and we'd stat/rename garbage paths. Issue #18.
func TestPoolSelfReleaseEmptyAgent(t *testing.T) {
	// Set ATEAM_MISSION_ID so we exercise the path past the missionID check.
	t.Setenv("ATEAM_MISSION_ID", "M-test-empty-agent")

	origStderr := os.Stderr
	r, w, err := os.Pipe()
	if err != nil {
		t.Fatalf("os.Pipe: %v", err)
	}
	os.Stderr = w
	t.Cleanup(func() {
		os.Stderr = origStderr
	})

	// Must not panic and must not emit a POOL_WARN.
	poolSelfRelease("")
	w.Close()
	buf := make([]byte, 4096)
	n, _ := r.Read(buf)
	stderr := string(buf[:n])
	if stderr != "" {
		t.Errorf("expected no stderr output for empty agent name, got: %s", stderr)
	}
}

// TestPoolSelfReleaseRenamesBusyToIdle verifies the happy path: with a valid
// mission ID and a fake .busy file in the pool dir, the file is renamed back
// to .idle. This test uses a temp dir as the pool root to avoid polluting /tmp.
func TestPoolSelfReleaseRenamesBusyToIdle(t *testing.T) {
	// poolSelfRelease hard-codes /tmp/.ateam-pool/<missionId>, so we must
	// materialize the expected structure there. Use a unique mission ID so
	// we can clean up without fighting other tests.
	missionID := "M-test-release-" + t.Name()
	poolDir := filepath.Join("/tmp/.ateam-pool", missionID)
	if err := os.MkdirAll(poolDir, 0755); err != nil {
		t.Fatalf("mkdir pool dir: %v", err)
	}
	t.Cleanup(func() {
		os.RemoveAll(poolDir)
	})

	busyFile := filepath.Join(poolDir, "murdock-1.busy")
	if err := os.WriteFile(busyFile, nil, 0644); err != nil {
		t.Fatalf("writing busy file: %v", err)
	}

	t.Setenv("ATEAM_MISSION_ID", missionID)
	poolSelfRelease("murdock-1")

	idleFile := filepath.Join(poolDir, "murdock-1.idle")
	if _, err := os.Stat(idleFile); err != nil {
		t.Errorf("expected %s to exist after release, stat err=%v", idleFile, err)
	}
	if _, err := os.Stat(busyFile); !os.IsNotExist(err) {
		t.Errorf("expected %s to have been renamed, stat err=%v", busyFile, err)
	}
}

// containsAll returns true iff s contains every substring in subs.
func containsAll(s string, subs []string) bool {
	for _, sub := range subs {
		if !containsStr(s, sub) {
			return false
		}
	}
	return true
}

func containsStr(s, sub string) bool {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}
