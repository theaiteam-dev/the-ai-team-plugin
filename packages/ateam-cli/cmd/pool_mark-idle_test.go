package cmd

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestPoolMarkIdleHappyPath(t *testing.T) {
	_, poolDir := withTempPoolRoot(t, "mark-idle-happy")
	if err := os.MkdirAll(poolDir, 0755); err != nil {
		t.Fatalf("mkdir pool: %v", err)
	}

	out, err := runPoolCmd(t, "pool", "mark-idle", "murdock-1")
	if err != nil {
		t.Fatalf("mark-idle failed: %v\noutput: %s", err, out)
	}

	idleFile := filepath.Join(poolDir, "murdock-1.idle")
	if _, statErr := os.Stat(idleFile); statErr != nil {
		t.Fatalf("expected %s to exist, stat err=%v", idleFile, statErr)
	}
}

func TestPoolMarkIdleErrorsWhenBusyExists(t *testing.T) {
	_, poolDir := withTempPoolRoot(t, "mark-idle-busy")
	if err := os.MkdirAll(poolDir, 0755); err != nil {
		t.Fatalf("mkdir pool: %v", err)
	}
	busyFile := filepath.Join(poolDir, "murdock-1.busy")
	if err := os.WriteFile(busyFile, nil, 0644); err != nil {
		t.Fatalf("writing busy file: %v", err)
	}

	out, err := runPoolCmd(t, "pool", "mark-idle", "murdock-1")
	if err == nil {
		t.Fatalf("expected error when .busy exists, got output: %s", out)
	}
	combined := err.Error() + out
	if !strings.Contains(combined, "busy") || !strings.Contains(combined, "release") {
		t.Errorf("expected error to mention busy and suggest 'release', got: %v / %s", err, out)
	}
	// Busy file must remain untouched
	if _, statErr := os.Stat(busyFile); statErr != nil {
		t.Errorf("expected %s to be untouched, stat err=%v", busyFile, statErr)
	}
}

func TestPoolMarkIdleErrorsWhenIdleAlreadyExists(t *testing.T) {
	_, poolDir := withTempPoolRoot(t, "mark-idle-double")
	if err := os.MkdirAll(poolDir, 0755); err != nil {
		t.Fatalf("mkdir pool: %v", err)
	}
	idleFile := filepath.Join(poolDir, "murdock-1.idle")
	if err := os.WriteFile(idleFile, nil, 0644); err != nil {
		t.Fatalf("writing idle file: %v", err)
	}

	out, err := runPoolCmd(t, "pool", "mark-idle", "murdock-1")
	if err == nil {
		t.Fatalf("expected error when .idle already exists, got output: %s", out)
	}
	if !strings.Contains(err.Error()+out, "already") {
		t.Errorf("expected error to mention 'already', got: %v / %s", err, out)
	}
}

func TestPoolMarkIdleErrorsWhenPoolDirMissing(t *testing.T) {
	_, poolDir := withTempPoolRoot(t, "mark-idle-no-dir")
	_ = os.RemoveAll(poolDir)

	out, err := runPoolCmd(t, "pool", "mark-idle", "murdock-1")
	if err == nil {
		t.Fatalf("expected error when pool dir missing, got output: %s", out)
	}
	if !strings.Contains(err.Error()+out, "init") {
		t.Errorf("expected error to suggest 'pool init', got: %v / %s", err, out)
	}
}

func TestPoolMarkIdleMissingMissionID(t *testing.T) {
	t.Setenv("ATEAM_MISSION_ID", "")

	out, err := runPoolCmd(t, "pool", "mark-idle", "murdock-1")
	if err == nil {
		t.Fatalf("expected error when ATEAM_MISSION_ID is unset, got output: %s", out)
	}
	if !strings.Contains(err.Error(), "ATEAM_MISSION_ID") {
		t.Errorf("expected error to mention ATEAM_MISSION_ID, got: %v", err)
	}
}

func TestPoolMarkIdleRequiresInstanceArg(t *testing.T) {
	_, poolDir := withTempPoolRoot(t, "mark-idle-no-arg")
	if err := os.MkdirAll(poolDir, 0755); err != nil {
		t.Fatalf("mkdir pool: %v", err)
	}

	_, err := runPoolCmd(t, "pool", "mark-idle")
	if err == nil {
		t.Fatalf("expected error when instance arg missing")
	}
}

func TestPoolMarkIdleJSONOutput(t *testing.T) {
	_, poolDir := withTempPoolRoot(t, "mark-idle-json")
	if err := os.MkdirAll(poolDir, 0755); err != nil {
		t.Fatalf("mkdir pool: %v", err)
	}

	out, err := runPoolCmd(t, "pool", "mark-idle", "ba-2", "--json")
	if err != nil {
		t.Fatalf("mark-idle --json failed: %v\noutput: %s", err, out)
	}

	var parsed map[string]interface{}
	if jerr := json.Unmarshal([]byte(extractJSON(out)), &parsed); jerr != nil {
		t.Fatalf("unmarshal output: %v\nraw: %s", jerr, out)
	}
	if parsed["instance"] != "ba-2" {
		t.Errorf("expected instance=ba-2, got %v", parsed["instance"])
	}
	if parsed["state"] != "idle" {
		t.Errorf("expected state=idle, got %v", parsed["state"])
	}
	wantPath := filepath.Join(poolDir, "ba-2.idle")
	if parsed["path"] != wantPath {
		t.Errorf("expected path=%q, got %v", wantPath, parsed["path"])
	}
}
