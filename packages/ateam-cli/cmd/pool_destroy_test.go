package cmd

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestPoolDestroyHappyPath(t *testing.T) {
	_, poolDir := withTempPoolRoot(t, "destroy-happy")
	if err := os.MkdirAll(poolDir, 0755); err != nil {
		t.Fatalf("mkdir pool: %v", err)
	}
	// Drop a file inside so we know rm -rf actually swept it
	if err := os.WriteFile(filepath.Join(poolDir, "murdock-1.idle"), nil, 0644); err != nil {
		t.Fatalf("seed: %v", err)
	}

	out, err := runPoolCmd(t, "pool", "destroy")
	if err != nil {
		t.Fatalf("destroy failed: %v\noutput: %s", err, out)
	}

	if _, statErr := os.Stat(poolDir); !os.IsNotExist(statErr) {
		t.Errorf("expected %s to be gone, stat err=%v", poolDir, statErr)
	}
}

func TestPoolDestroyIdempotent(t *testing.T) {
	_, poolDir := withTempPoolRoot(t, "destroy-idempotent")
	_ = os.RemoveAll(poolDir) // pre-condition: dir does NOT exist

	out, err := runPoolCmd(t, "pool", "destroy")
	if err != nil {
		t.Fatalf("destroy on missing dir should succeed, got err=%v output=%s", err, out)
	}
}

func TestPoolDestroyMissingMissionID(t *testing.T) {
	t.Setenv("ATEAM_MISSION_ID", "")

	out, err := runPoolCmd(t, "pool", "destroy")
	if err == nil {
		t.Fatalf("expected error when ATEAM_MISSION_ID is unset, got output: %s", out)
	}
	if !strings.Contains(err.Error(), "ATEAM_MISSION_ID") {
		t.Errorf("expected error to mention ATEAM_MISSION_ID, got: %v", err)
	}
}

func TestPoolDestroyJSONOutput(t *testing.T) {
	missionID, poolDir := withTempPoolRoot(t, "destroy-json")
	if err := os.MkdirAll(poolDir, 0755); err != nil {
		t.Fatalf("mkdir pool: %v", err)
	}

	out, err := runPoolCmd(t, "pool", "destroy", "--json")
	if err != nil {
		t.Fatalf("destroy --json failed: %v\noutput: %s", err, out)
	}
	var parsed map[string]interface{}
	if jerr := json.Unmarshal([]byte(extractJSON(out)), &parsed); jerr != nil {
		t.Fatalf("unmarshal: %v\nraw: %s", jerr, out)
	}
	if parsed["missionId"] != missionID {
		t.Errorf("expected missionId=%q, got %v", missionID, parsed["missionId"])
	}
	if parsed["poolDir"] != poolDir {
		t.Errorf("expected poolDir=%q, got %v", poolDir, parsed["poolDir"])
	}
	if parsed["removed"] != true {
		t.Errorf("expected removed=true on real removal, got %v", parsed["removed"])
	}

	// Second call: nothing left to remove
	out2, err2 := runPoolCmd(t, "pool", "destroy", "--json")
	if err2 != nil {
		t.Fatalf("second destroy --json failed: %v\noutput: %s", err2, out2)
	}
	var parsed2 map[string]interface{}
	if jerr := json.Unmarshal([]byte(extractJSON(out2)), &parsed2); jerr != nil {
		t.Fatalf("unmarshal second: %v\nraw: %s", jerr, out2)
	}
	if parsed2["removed"] != false {
		t.Errorf("expected removed=false when dir already gone, got %v", parsed2["removed"])
	}
}
