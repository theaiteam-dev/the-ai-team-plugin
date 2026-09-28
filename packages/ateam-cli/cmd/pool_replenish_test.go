package cmd

import (
	"encoding/json"
	"os"
	"strings"
	"testing"
)

func TestPoolReplenishCommandReturnsExpectedCount(t *testing.T) {
	_, poolDir := withTempPoolRoot(t, "replenish-cmd")
	enableSingleUse(t, poolDir)
	writeMarkers(t, poolDir, "ba-1.idle")

	// Two items still need implementing, one idle B.A.: count should be 1.
	board := boardJSON(t, []string{"ready", "ready", "implementing"}, nil)
	srv := routedServer(t, successResponse(), board)
	defer srv.Close()

	out, err := runPoolCmd(t, "pool", "replenish", "ba", "--base-url", srv.URL, "--json")
	if err != nil {
		t.Fatalf("pool replenish: %v (%s)", err, out)
	}
	var info replenishInfo
	if jerr := json.Unmarshal([]byte(extractJSON(out)), &info); jerr != nil {
		t.Fatalf("unmarshal: %v\nraw: %s", jerr, out)
	}
	if info.AgentType != "ba" || info.Demand != 2 || info.Idle != 1 || info.Count != 1 {
		t.Errorf("unexpected replenish info: %+v", info)
	}
}

func TestPoolReplenishRespectsConfiguredLanes(t *testing.T) {
	_, poolDir := withTempPoolRoot(t, "replenish-cmd-lanes")
	enableSingleUse(t, poolDir)
	if err := writeLanes(poolDir, 1); err != nil {
		t.Fatalf("writeLanes: %v", err)
	}

	board := boardJSON(t, []string{"ready", "ready", "ready"}, nil)
	srv := routedServer(t, successResponse(), board)
	defer srv.Close()

	out, err := runPoolCmd(t, "pool", "replenish", "ba", "--base-url", srv.URL, "--json")
	if err != nil {
		t.Fatalf("pool replenish: %v (%s)", err, out)
	}
	var info replenishInfo
	if jerr := json.Unmarshal([]byte(extractJSON(out)), &info); jerr != nil {
		t.Fatalf("unmarshal: %v\nraw: %s", jerr, out)
	}
	if info.Demand != 3 || info.Count != 1 || info.Lanes != 1 {
		t.Errorf("expected the lane cap to bound count to 1, got %+v", info)
	}
}

func TestPoolReplenishErrorsInReuseMode(t *testing.T) {
	_, poolDir := withTempPoolRoot(t, "replenish-reuse")
	if err := os.MkdirAll(poolDir, 0755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}

	srv := routedServer(t, successResponse(), boardJSON(t, []string{"ready"}, nil))
	defer srv.Close()

	out, err := runPoolCmd(t, "pool", "replenish", "ba", "--base-url", srv.URL)
	if err == nil {
		t.Fatalf("expected reuse-mode pool replenish to error, got output: %s", out)
	}
	if !strings.Contains(err.Error(), "single-use") {
		t.Errorf("expected error to mention single-use, got: %v", err)
	}
}

func TestPoolReplenishErrorsForNonPipelineAgentType(t *testing.T) {
	_, poolDir := withTempPoolRoot(t, "replenish-bad-type")
	enableSingleUse(t, poolDir)

	srv := routedServer(t, successResponse(), boardJSON(t, []string{"ready"}, nil))
	defer srv.Close()

	out, err := runPoolCmd(t, "pool", "replenish", "hannibal", "--base-url", srv.URL)
	if err == nil {
		t.Fatalf("expected an error for a non-pipeline agent type, got output: %s", out)
	}
	if !strings.Contains(err.Error(), "pipeline stage") {
		t.Errorf("expected error to mention pipeline stage, got: %v", err)
	}
}

func TestPoolReplenishErrorsWhenPoolDirMissing(t *testing.T) {
	_, poolDir := withTempPoolRoot(t, "replenish-missing")
	_ = os.RemoveAll(poolDir)

	out, err := runPoolCmd(t, "pool", "replenish", "ba")
	if err == nil {
		t.Fatalf("expected an error when the pool dir does not exist, got output: %s", out)
	}
	if !strings.Contains(err.Error(), "does not exist") {
		t.Errorf("expected error to mention the missing pool dir, got: %v", err)
	}
}
