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
	got := claimIdleInstance(missing, "murdock")
	w.Close()
	buf := make([]byte, 4096)
	n, _ := r.Read(buf)
	stderr := string(buf[:n])

	if got != "" {
		t.Errorf("expected empty string when pool dir is missing, got %q", got)
	}
	if !containsAll(stderr, []string{"POOL_WARN", missing, "does not exist"}) {
		t.Errorf("expected POOL_WARN with path and explanation in stderr, got: %s", stderr)
	}
}

// TestClaimIdleInstanceHappyPath verifies that with a pool dir containing an
// idle file, claimIdleInstance renames it to .busy and returns the instance name.
func TestClaimIdleInstanceHappyPath(t *testing.T) {
	poolDir := t.TempDir()
	idleFile := filepath.Join(poolDir, "murdock-1.idle")
	if err := os.WriteFile(idleFile, nil, 0644); err != nil {
		t.Fatalf("writing idle file: %v", err)
	}

	got := claimIdleInstance(poolDir, "murdock")
	if got != "murdock-1" {
		t.Errorf("expected claim of 'murdock-1', got %q", got)
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

	got := claimIdleInstance(poolDir, "murdock")
	w.Close()
	buf := make([]byte, 4096)
	n, _ := r.Read(buf)
	stderr := string(buf[:n])

	if got != "" {
		t.Errorf("expected empty claim for empty pool dir, got %q", got)
	}
	if stderr != "" {
		t.Errorf("expected no stderr output, got: %s", stderr)
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
