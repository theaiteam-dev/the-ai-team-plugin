package cmd

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// runPoolCmd executes the rootCmd with the given args and returns combined
// stdout/stderr (cobra writes both to the configured Out/Err) plus any error.
// Each call resets buffers so tests don't bleed into each other.
func runPoolCmd(t *testing.T, args ...string) (string, error) {
	t.Helper()
	var buf bytes.Buffer
	rootCmd.SetOut(&buf)
	rootCmd.SetErr(&buf)
	rootCmd.SetArgs(args)
	err := rootCmd.Execute()
	return buf.String(), err
}

// withTempPoolRoot redirects /tmp/.ateam-pool/<missionId> to a per-test temp
// dir by setting ATEAM_MISSION_ID to a unique value and returning the
// resulting pool dir path. Caller is responsible for any cleanup of /tmp.
func withTempPoolRoot(t *testing.T, prefix string) (missionID, poolDir string) {
	t.Helper()
	missionID = "M-test-" + prefix + "-" + strings.ReplaceAll(t.Name(), "/", "_")
	poolDir = filepath.Join("/tmp/.ateam-pool", missionID)
	t.Setenv("ATEAM_MISSION_ID", missionID)
	t.Cleanup(func() {
		_ = os.RemoveAll(poolDir)
	})
	return missionID, poolDir
}

func TestPoolInitCreatesDirectory(t *testing.T) {
	_, poolDir := withTempPoolRoot(t, "init-create")
	// Ensure clean slate
	_ = os.RemoveAll(poolDir)

	out, err := runPoolCmd(t, "pool", "init")
	if err != nil {
		t.Fatalf("pool init failed: %v\noutput: %s", err, out)
	}

	info, statErr := os.Stat(poolDir)
	if statErr != nil {
		t.Fatalf("expected pool dir %s to exist, stat err=%v", poolDir, statErr)
	}
	if !info.IsDir() {
		t.Fatalf("expected %s to be a directory", poolDir)
	}
}

func TestPoolInitIdempotent(t *testing.T) {
	_, poolDir := withTempPoolRoot(t, "init-idempotent")
	if err := os.MkdirAll(poolDir, 0755); err != nil {
		t.Fatalf("pre-creating pool dir: %v", err)
	}
	// Drop a marker file in the dir to prove the second init doesn't wipe it.
	marker := filepath.Join(poolDir, "preexisting.idle")
	if err := os.WriteFile(marker, nil, 0644); err != nil {
		t.Fatalf("writing marker: %v", err)
	}

	out, err := runPoolCmd(t, "pool", "init")
	if err != nil {
		t.Fatalf("idempotent pool init failed: %v\noutput: %s", err, out)
	}

	if _, statErr := os.Stat(marker); statErr != nil {
		t.Fatalf("expected marker %s to survive idempotent init, stat err=%v", marker, statErr)
	}
}

func TestPoolInitMissingMissionID(t *testing.T) {
	t.Setenv("ATEAM_MISSION_ID", "")

	out, err := runPoolCmd(t, "pool", "init")
	if err == nil {
		t.Fatalf("expected error when ATEAM_MISSION_ID is unset, got output: %s", out)
	}
	if !strings.Contains(err.Error(), "ATEAM_MISSION_ID") {
		t.Errorf("expected error message to mention ATEAM_MISSION_ID, got: %v", err)
	}
}

func TestPoolInitJSONOutput(t *testing.T) {
	missionID, poolDir := withTempPoolRoot(t, "init-json-create")
	_ = os.RemoveAll(poolDir)

	out, err := runPoolCmd(t, "pool", "init", "--json")
	if err != nil {
		t.Fatalf("pool init --json failed: %v\noutput: %s", err, out)
	}

	var parsed map[string]interface{}
	if jerr := json.Unmarshal([]byte(extractJSON(out)), &parsed); jerr != nil {
		t.Fatalf("unmarshal output: %v\nraw: %s", jerr, out)
	}
	if parsed["missionId"] != missionID {
		t.Errorf("expected missionId=%q, got %v", missionID, parsed["missionId"])
	}
	if parsed["poolDir"] != poolDir {
		t.Errorf("expected poolDir=%q, got %v", poolDir, parsed["poolDir"])
	}
	if parsed["created"] != true {
		t.Errorf("expected created=true on fresh init, got %v", parsed["created"])
	}

	// Second run should report created=false
	out2, err2 := runPoolCmd(t, "pool", "init", "--json")
	if err2 != nil {
		t.Fatalf("second pool init --json failed: %v\noutput: %s", err2, out2)
	}
	var parsed2 map[string]interface{}
	if jerr := json.Unmarshal([]byte(extractJSON(out2)), &parsed2); jerr != nil {
		t.Fatalf("unmarshal second output: %v\nraw: %s", jerr, out2)
	}
	if parsed2["created"] != false {
		t.Errorf("expected created=false on second init, got %v", parsed2["created"])
	}
}

// extractJSON returns the substring of s starting from the first '{' through
// the last '}'. cobra's buffer may include trailing newlines or other noise
// from logging; this keeps tests robust without changing production output.
func extractJSON(s string) string {
	start := strings.Index(s, "{")
	end := strings.LastIndex(s, "}")
	if start < 0 || end < 0 || end < start {
		return s
	}
	return s[start : end+1]
}
