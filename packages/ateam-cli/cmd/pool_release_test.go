package cmd

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestPoolReleaseHappyPath(t *testing.T) {
	_, poolDir := withTempPoolRoot(t, "release-happy")
	if err := os.MkdirAll(poolDir, 0755); err != nil {
		t.Fatalf("mkdir pool: %v", err)
	}
	busyFile := filepath.Join(poolDir, "murdock-1.busy")
	if err := os.WriteFile(busyFile, nil, 0644); err != nil {
		t.Fatalf("writing busy file: %v", err)
	}

	out, err := runPoolCmd(t, "pool", "release", "murdock-1")
	if err != nil {
		t.Fatalf("release failed: %v\noutput: %s", err, out)
	}

	if _, statErr := os.Stat(busyFile); !os.IsNotExist(statErr) {
		t.Errorf("expected %s to be gone, stat err=%v", busyFile, statErr)
	}
	idleFile := filepath.Join(poolDir, "murdock-1.idle")
	if _, statErr := os.Stat(idleFile); statErr != nil {
		t.Errorf("expected %s to exist, stat err=%v", idleFile, statErr)
	}
	// The POOL_WARN must have been printed somewhere
	if !strings.Contains(out, "POOL_WARN") {
		t.Errorf("expected POOL_WARN in output, got: %s", out)
	}
	if !strings.Contains(out, "murdock-1") {
		t.Errorf("expected instance name in warning, got: %s", out)
	}
}

func TestPoolReleaseErrorsWhenNoBusyFile(t *testing.T) {
	_, poolDir := withTempPoolRoot(t, "release-no-busy")
	if err := os.MkdirAll(poolDir, 0755); err != nil {
		t.Fatalf("mkdir pool: %v", err)
	}

	out, err := runPoolCmd(t, "pool", "release", "murdock-1")
	if err == nil {
		t.Fatalf("expected error when .busy missing, got output: %s", out)
	}
	if !strings.Contains(err.Error()+out, "busy") {
		t.Errorf("expected error to mention .busy, got: %v / %s", err, out)
	}
}

func TestPoolReleaseErrorsWhenIdleAlreadyExists(t *testing.T) {
	_, poolDir := withTempPoolRoot(t, "release-clobber")
	if err := os.MkdirAll(poolDir, 0755); err != nil {
		t.Fatalf("mkdir pool: %v", err)
	}
	busyFile := filepath.Join(poolDir, "murdock-1.busy")
	if err := os.WriteFile(busyFile, nil, 0644); err != nil {
		t.Fatalf("writing busy: %v", err)
	}
	idleFile := filepath.Join(poolDir, "murdock-1.idle")
	if err := os.WriteFile(idleFile, nil, 0644); err != nil {
		t.Fatalf("writing idle: %v", err)
	}

	out, err := runPoolCmd(t, "pool", "release", "murdock-1")
	if err == nil {
		t.Fatalf("expected error when both .busy and .idle exist, got output: %s", out)
	}
	if !strings.Contains(err.Error()+out, "idle") {
		t.Errorf("expected error to mention .idle, got: %v / %s", err, out)
	}
	// Both files should remain — no destructive change
	if _, statErr := os.Stat(busyFile); statErr != nil {
		t.Errorf("busy file should be untouched, stat err=%v", statErr)
	}
	if _, statErr := os.Stat(idleFile); statErr != nil {
		t.Errorf("idle file should be untouched, stat err=%v", statErr)
	}
}

func TestPoolReleaseMissingMissionID(t *testing.T) {
	t.Setenv("ATEAM_MISSION_ID", "")

	out, err := runPoolCmd(t, "pool", "release", "murdock-1")
	if err == nil {
		t.Fatalf("expected error when ATEAM_MISSION_ID is unset, got output: %s", out)
	}
	if !strings.Contains(err.Error(), "ATEAM_MISSION_ID") {
		t.Errorf("expected error to mention ATEAM_MISSION_ID, got: %v", err)
	}
}

func TestPoolReleaseRequiresInstanceArg(t *testing.T) {
	_, poolDir := withTempPoolRoot(t, "release-no-arg")
	if err := os.MkdirAll(poolDir, 0755); err != nil {
		t.Fatalf("mkdir pool: %v", err)
	}

	_, err := runPoolCmd(t, "pool", "release")
	if err == nil {
		t.Fatalf("expected error when instance arg missing")
	}
}

func TestPoolReleaseJSONOutput(t *testing.T) {
	_, poolDir := withTempPoolRoot(t, "release-json")
	if err := os.MkdirAll(poolDir, 0755); err != nil {
		t.Fatalf("mkdir pool: %v", err)
	}
	busyFile := filepath.Join(poolDir, "ba-2.busy")
	if err := os.WriteFile(busyFile, nil, 0644); err != nil {
		t.Fatalf("writing busy: %v", err)
	}

	out, err := runPoolCmd(t, "pool", "release", "ba-2", "--json")
	if err != nil {
		t.Fatalf("release --json failed: %v\noutput: %s", err, out)
	}

	var parsed map[string]interface{}
	if jerr := json.Unmarshal([]byte(extractJSON(out)), &parsed); jerr != nil {
		t.Fatalf("unmarshal: %v\nraw: %s", jerr, out)
	}
	if parsed["instance"] != "ba-2" {
		t.Errorf("expected instance=ba-2, got %v", parsed["instance"])
	}
	if parsed["state"] != "idle" {
		t.Errorf("expected state=idle, got %v", parsed["state"])
	}
	if parsed["warned"] != true {
		t.Errorf("expected warned=true, got %v", parsed["warned"])
	}
	// The POOL_WARN should still appear (on stderr) even with --json
	if !strings.Contains(out, "POOL_WARN") {
		t.Errorf("expected POOL_WARN to appear even with --json, got: %s", out)
	}
}
