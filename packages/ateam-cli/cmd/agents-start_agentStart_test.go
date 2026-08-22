package cmd

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// agentStartSuccessResponse returns a minimal valid agentStart API response.
func agentStartSuccessResponse() []byte {
	resp := map[string]interface{}{
		"success": true,
		"data": map[string]interface{}{
			"itemId": "WI-001",
			"agent":  "Murdock",
		},
	}
	b, _ := json.Marshal(resp)
	return b
}

// executeAgentStart runs the agentStart command with the given args against the
// mock server. Returns stdout output and any error. Mirrors executeAgentStop's
// structure (see agents-stop_agentStop_test.go).
func executeAgentStart(t *testing.T, serverURL string, extraArgs ...string) (string, error) {
	t.Helper()
	// Reset flag state before AND after: cobra keeps Changed() and module
	// variables on the shared rootCmd, so prior tests would otherwise leak.
	resetAgentsStartAgentStartFlagsForTest()
	t.Cleanup(resetAgentsStartAgentStartFlagsForTest)
	var buf bytes.Buffer
	rootCmd.SetOut(&buf)
	rootCmd.SetErr(&buf)

	baseArgs := []string{
		"agents-start", "agentStart",
		"--base-url", serverURL,
		"--itemId", "WI-001",
		"--agent", "Murdock",
		"--no-color",
	}
	rootCmd.SetArgs(append(baseArgs, extraArgs...))
	err := rootCmd.Execute()
	return buf.String(), err
}

// TestAgentStartAcceptsFrankie verifies the client-side validate.Enum allowed-list
// includes Frankie: the request must actually reach the mock server rather than
// being rejected locally before any HTTP call (WI-774 AC6).
func TestAgentStartAcceptsFrankie(t *testing.T) {
	requestReceived := false
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestReceived = true
		w.Header().Set("Content-Type", "application/json")
		w.Write(agentStartSuccessResponse())
	}))
	defer srv.Close()

	_, err := executeAgentStart(t, srv.URL, "--agent", "Frankie")
	if err != nil {
		t.Fatalf("unexpected error validating --agent Frankie: %v", err)
	}
	if !requestReceived {
		t.Error("expected the mock server to receive the request, but client-side validation blocked it before the HTTP call")
	}
}

// TestAgentStartRejectsUnknownAgent verifies an unrecognised --agent value is
// still rejected by the client-side validate.Enum check, and never reaches the
// server (WI-774 AC6's negative counterpart).
func TestAgentStartRejectsUnknownAgent(t *testing.T) {
	requestReceived := false
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestReceived = true
		w.Header().Set("Content-Type", "application/json")
		w.Write(agentStartSuccessResponse())
	}))
	defer srv.Close()

	_, err := executeAgentStart(t, srv.URL, "--agent", "NotAnAgent")
	if err == nil {
		t.Fatal("expected an error for --agent NotAnAgent, got nil")
	}
	if requestReceived {
		t.Error("expected client-side validation to reject before any HTTP call, but the mock server received a request")
	}
}
