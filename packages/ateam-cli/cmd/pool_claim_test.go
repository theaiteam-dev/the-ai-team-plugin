package cmd

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
)

func TestPoolClaimHappyPath(t *testing.T) {
	_, poolDir := withTempPoolRoot(t, "claim-happy")
	if err := os.MkdirAll(poolDir, 0755); err != nil {
		t.Fatalf("mkdir pool: %v", err)
	}
	idleFile := filepath.Join(poolDir, "murdock-1.idle")
	if err := os.WriteFile(idleFile, nil, 0644); err != nil {
		t.Fatalf("writing idle file: %v", err)
	}

	out, err := runPoolCmd(t, "pool", "claim", "murdock-1")
	if err != nil {
		t.Fatalf("claim failed: %v\noutput: %s", err, out)
	}

	if _, statErr := os.Stat(idleFile); !os.IsNotExist(statErr) {
		t.Errorf("expected %s to be gone, stat err=%v", idleFile, statErr)
	}
	busyFile := filepath.Join(poolDir, "murdock-1.busy")
	if _, statErr := os.Stat(busyFile); statErr != nil {
		t.Errorf("expected %s to exist, stat err=%v", busyFile, statErr)
	}
	// Claim is the normal hot path — must NOT print POOL_WARN.
	if strings.Contains(out, "POOL_WARN") {
		t.Errorf("expected NO POOL_WARN on claim, got: %s", out)
	}
}

func TestPoolClaimMissingMissionID(t *testing.T) {
	t.Setenv("ATEAM_MISSION_ID", "")

	out, err := runPoolCmd(t, "pool", "claim", "murdock-1")
	if err == nil {
		t.Fatalf("expected error when ATEAM_MISSION_ID is unset, got output: %s", out)
	}
	if !strings.Contains(err.Error(), "ATEAM_MISSION_ID") {
		t.Errorf("expected error to mention ATEAM_MISSION_ID, got: %v", err)
	}
}

func TestPoolClaimErrorsWhenPoolDirMissing(t *testing.T) {
	_, poolDir := withTempPoolRoot(t, "claim-no-dir")
	// Ensure pool dir does NOT exist
	_ = os.RemoveAll(poolDir)

	out, err := runPoolCmd(t, "pool", "claim", "murdock-1")
	if err == nil {
		t.Fatalf("expected error when pool dir missing, got output: %s", out)
	}
	if !strings.Contains(err.Error(), "pool init") {
		t.Errorf("expected error to mention 'pool init', got: %v", err)
	}
}

func TestPoolClaimErrorsWhenAlreadyClaimed(t *testing.T) {
	_, poolDir := withTempPoolRoot(t, "claim-already")
	if err := os.MkdirAll(poolDir, 0755); err != nil {
		t.Fatalf("mkdir pool: %v", err)
	}
	// .idle missing, .busy present → already claimed
	busyFile := filepath.Join(poolDir, "murdock-1.busy")
	if err := os.WriteFile(busyFile, nil, 0644); err != nil {
		t.Fatalf("writing busy: %v", err)
	}

	out, err := runPoolCmd(t, "pool", "claim", "murdock-1")
	if err == nil {
		t.Fatalf("expected error when slot already claimed, got output: %s", out)
	}
	if !strings.Contains(strings.ToLower(err.Error()), "already claimed") {
		t.Errorf("expected error to mention 'already claimed', got: %v", err)
	}
	// .busy must still be there, untouched
	if _, statErr := os.Stat(busyFile); statErr != nil {
		t.Errorf("busy file should be untouched, stat err=%v", statErr)
	}
}

func TestPoolClaimErrorsWhenNoSuchInstance(t *testing.T) {
	_, poolDir := withTempPoolRoot(t, "claim-no-instance")
	if err := os.MkdirAll(poolDir, 0755); err != nil {
		t.Fatalf("mkdir pool: %v", err)
	}
	// Neither .idle nor .busy

	out, err := runPoolCmd(t, "pool", "claim", "murdock-1")
	if err == nil {
		t.Fatalf("expected error when no .idle or .busy exists, got output: %s", out)
	}
	if !strings.Contains(strings.ToLower(err.Error()), "no such instance") {
		t.Errorf("expected error to mention 'no such instance', got: %v", err)
	}
	if !strings.Contains(err.Error(), "mark-idle") {
		t.Errorf("expected error to reference mark-idle, got: %v", err)
	}
}

func TestPoolClaimErrorsWhenCorruptedState(t *testing.T) {
	_, poolDir := withTempPoolRoot(t, "claim-corrupt")
	if err := os.MkdirAll(poolDir, 0755); err != nil {
		t.Fatalf("mkdir pool: %v", err)
	}
	idleFile := filepath.Join(poolDir, "murdock-1.idle")
	busyFile := filepath.Join(poolDir, "murdock-1.busy")
	if err := os.WriteFile(idleFile, nil, 0644); err != nil {
		t.Fatalf("writing idle: %v", err)
	}
	if err := os.WriteFile(busyFile, nil, 0644); err != nil {
		t.Fatalf("writing busy: %v", err)
	}

	out, err := runPoolCmd(t, "pool", "claim", "murdock-1")
	if err == nil {
		t.Fatalf("expected error when both .idle and .busy exist, got output: %s", out)
	}
	if !strings.Contains(strings.ToLower(err.Error()), "corrupt") {
		t.Errorf("expected error to mention 'corrupt', got: %v", err)
	}
	// Both files must remain untouched
	if _, statErr := os.Stat(idleFile); statErr != nil {
		t.Errorf("idle file should be untouched, stat err=%v", statErr)
	}
	if _, statErr := os.Stat(busyFile); statErr != nil {
		t.Errorf("busy file should be untouched, stat err=%v", statErr)
	}
}

func TestPoolClaimRequiresInstanceArg(t *testing.T) {
	_, poolDir := withTempPoolRoot(t, "claim-no-arg")
	if err := os.MkdirAll(poolDir, 0755); err != nil {
		t.Fatalf("mkdir pool: %v", err)
	}

	_, err := runPoolCmd(t, "pool", "claim")
	if err == nil {
		t.Fatalf("expected error when instance arg missing")
	}
}

func TestPoolClaimJSONOutput(t *testing.T) {
	_, poolDir := withTempPoolRoot(t, "claim-json")
	if err := os.MkdirAll(poolDir, 0755); err != nil {
		t.Fatalf("mkdir pool: %v", err)
	}
	idleFile := filepath.Join(poolDir, "ba-2.idle")
	if err := os.WriteFile(idleFile, nil, 0644); err != nil {
		t.Fatalf("writing idle: %v", err)
	}

	out, err := runPoolCmd(t, "pool", "claim", "ba-2", "--json")
	if err != nil {
		t.Fatalf("claim --json failed: %v\noutput: %s", err, out)
	}

	var parsed map[string]interface{}
	if jerr := json.Unmarshal([]byte(extractJSON(out)), &parsed); jerr != nil {
		t.Fatalf("unmarshal: %v\nraw: %s", jerr, out)
	}
	if parsed["instance"] != "ba-2" {
		t.Errorf("expected instance=ba-2, got %v", parsed["instance"])
	}
	if parsed["state"] != "busy" {
		t.Errorf("expected state=busy, got %v", parsed["state"])
	}
	expectedPath := filepath.Join(poolDir, "ba-2.busy")
	if parsed["path"] != expectedPath {
		t.Errorf("expected path=%q, got %v", expectedPath, parsed["path"])
	}
}

func TestPoolClaimRaceSafety(t *testing.T) {
	_, poolDir := withTempPoolRoot(t, "claim-race")
	if err := os.MkdirAll(poolDir, 0755); err != nil {
		t.Fatalf("mkdir pool: %v", err)
	}
	idleFile := filepath.Join(poolDir, "lynch-1.idle")
	if err := os.WriteFile(idleFile, nil, 0644); err != nil {
		t.Fatalf("writing idle: %v", err)
	}

	// Two goroutines race to claim the same slot. Exactly one must win.
	// We bypass runPoolCmd because cobra's rootCmd is not goroutine-safe
	// (shared buffer + SetArgs). Instead, replicate the verb's atomic step
	// — os.Rename — which is what the production code must rely on.
	missionID := os.Getenv("ATEAM_MISSION_ID")
	if missionID == "" {
		t.Fatal("missionID empty — withTempPoolRoot didn't set it")
	}
	src := filepath.Join(poolDir, "lynch-1.idle")
	dst := filepath.Join(poolDir, "lynch-1.busy")

	var wg sync.WaitGroup
	var successes int32
	var failures int32
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if err := os.Rename(src, dst); err == nil {
				atomic.AddInt32(&successes, 1)
			} else {
				atomic.AddInt32(&failures, 1)
			}
		}()
	}
	wg.Wait()

	if successes != 1 {
		t.Errorf("expected exactly 1 successful rename, got %d", successes)
	}
	if failures != 1 {
		t.Errorf("expected exactly 1 failed rename, got %d", failures)
	}
	if _, statErr := os.Stat(dst); statErr != nil {
		t.Errorf("expected %s to exist after race, stat err=%v", dst, statErr)
	}
	if _, statErr := os.Stat(src); !os.IsNotExist(statErr) {
		t.Errorf("expected %s to be gone after race, stat err=%v", src, statErr)
	}
}
