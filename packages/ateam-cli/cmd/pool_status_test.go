package cmd

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// TestPoolStatusDistinguishesMissingFromEmpty ensures the schema differentiates
// "no pool yet" (poolDirExists=false) from "real empty pool" (poolDirExists=true,
// idle=[], busy=[]). Both used to render identically.
func TestPoolStatusDistinguishesMissingFromEmpty(t *testing.T) {
	t.Run("missing dir reports poolDirExists=false in JSON", func(t *testing.T) {
		_, poolDir := withTempPoolRoot(t, "status-missing")
		_ = os.RemoveAll(poolDir)

		out, err := runPoolCmd(t, "pool", "status", "--json")
		if err != nil {
			t.Fatalf("pool status --json failed: %v\noutput: %s", err, out)
		}

		var parsed map[string]interface{}
		if jerr := json.Unmarshal([]byte(extractJSON(out)), &parsed); jerr != nil {
			t.Fatalf("unmarshal: %v\nraw: %s", jerr, out)
		}
		if parsed["poolDirExists"] != false {
			t.Errorf("expected poolDirExists=false, got %v", parsed["poolDirExists"])
		}
		// Schema must stay stable: idle, busy, byType present even when missing.
		if _, ok := parsed["idle"]; !ok {
			t.Errorf("expected idle field present")
		}
		if _, ok := parsed["busy"]; !ok {
			t.Errorf("expected busy field present")
		}
		if _, ok := parsed["byType"]; !ok {
			t.Errorf("expected byType field present")
		}
	})

	t.Run("missing dir prints helpful human message", func(t *testing.T) {
		_, poolDir := withTempPoolRoot(t, "status-missing-human")
		_ = os.RemoveAll(poolDir)

		out, err := runPoolCmd(t, "pool", "status")
		if err != nil {
			t.Fatalf("pool status failed: %v\noutput: %s", err, out)
		}
		if !strings.Contains(out, "does not exist") {
			t.Errorf("expected output to say 'does not exist', got: %s", out)
		}
		if !strings.Contains(out, "pool init") {
			t.Errorf("expected output to suggest 'pool init', got: %s", out)
		}
		if !strings.Contains(out, poolDir) {
			t.Errorf("expected output to include the pool dir path, got: %s", out)
		}
	})

	t.Run("empty dir reports poolDirExists=true in JSON", func(t *testing.T) {
		_, poolDir := withTempPoolRoot(t, "status-empty")
		if err := os.MkdirAll(poolDir, 0755); err != nil {
			t.Fatalf("mkdir: %v", err)
		}

		out, err := runPoolCmd(t, "pool", "status", "--json")
		if err != nil {
			t.Fatalf("pool status --json failed: %v\noutput: %s", err, out)
		}
		var parsed map[string]interface{}
		if jerr := json.Unmarshal([]byte(extractJSON(out)), &parsed); jerr != nil {
			t.Fatalf("unmarshal: %v\nraw: %s", jerr, out)
		}
		if parsed["poolDirExists"] != true {
			t.Errorf("expected poolDirExists=true, got %v", parsed["poolDirExists"])
		}
		idle, _ := parsed["idle"].([]interface{})
		busy, _ := parsed["busy"].([]interface{})
		if len(idle) != 0 || len(busy) != 0 {
			t.Errorf("expected empty idle/busy, got idle=%v busy=%v", idle, busy)
		}
	})

	t.Run("empty dir prints empty marker in human mode", func(t *testing.T) {
		_, poolDir := withTempPoolRoot(t, "status-empty-human")
		if err := os.MkdirAll(poolDir, 0755); err != nil {
			t.Fatalf("mkdir: %v", err)
		}

		out, err := runPoolCmd(t, "pool", "status")
		if err != nil {
			t.Fatalf("pool status failed: %v\noutput: %s", err, out)
		}
		if !strings.Contains(out, "pool is empty") {
			t.Errorf("expected 'pool is empty' message, got: %s", out)
		}
		if strings.Contains(out, "does not exist") {
			t.Errorf("did not expect 'does not exist' for an empty dir, got: %s", out)
		}
	})

	t.Run("populated dir lists entries", func(t *testing.T) {
		_, poolDir := withTempPoolRoot(t, "status-populated")
		if err := os.MkdirAll(poolDir, 0755); err != nil {
			t.Fatalf("mkdir: %v", err)
		}
		for _, n := range []string{"murdock-1.idle", "murdock-2.busy", "ba-1.idle"} {
			if err := os.WriteFile(filepath.Join(poolDir, n), nil, 0644); err != nil {
				t.Fatalf("write %s: %v", n, err)
			}
		}

		out, err := runPoolCmd(t, "pool", "status", "--json")
		if err != nil {
			t.Fatalf("pool status --json failed: %v\noutput: %s", err, out)
		}
		var parsed map[string]interface{}
		if jerr := json.Unmarshal([]byte(extractJSON(out)), &parsed); jerr != nil {
			t.Fatalf("unmarshal: %v\nraw: %s", jerr, out)
		}
		if parsed["poolDirExists"] != true {
			t.Errorf("expected poolDirExists=true, got %v", parsed["poolDirExists"])
		}
		idle, _ := parsed["idle"].([]interface{})
		busy, _ := parsed["busy"].([]interface{})
		if len(idle) != 2 {
			t.Errorf("expected 2 idle, got %v", idle)
		}
		if len(busy) != 1 {
			t.Errorf("expected 1 busy, got %v", busy)
		}
	})
}

func TestPoolStatusMissingMissionID(t *testing.T) {
	t.Setenv("ATEAM_MISSION_ID", "")

	out, err := runPoolCmd(t, "pool", "status")
	if err == nil {
		t.Fatalf("expected error when ATEAM_MISSION_ID is unset, got output: %s", out)
	}
	if !strings.Contains(err.Error(), "ATEAM_MISSION_ID") {
		t.Errorf("expected error to mention ATEAM_MISSION_ID, got: %v", err)
	}
}
