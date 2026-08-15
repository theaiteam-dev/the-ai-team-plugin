package cmd

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// resetBoardClaimClaimItemFlagsForTest clears module variables and cobra flag
// Changed() status for the `board-claim claimItem` subcommand. Follows the
// conventions in testhelpers_test.go; lives here because that file is shared
// with other suites and owned elsewhere.
func resetBoardClaimClaimItemFlagsForTest() {
	boardClaimClaimItemCmdBody = ""
	boardClaimClaimItemCmdBodyFile = ""
	boardClaimClaimItemCmd_agent = ""
	boardClaimClaimItemCmd_itemId = ""
	flags := boardClaimClaimItemCmd.Flags()
	for _, name := range []string{"body", "body-file", "agent", "itemId"} {
		if f := flags.Lookup(name); f != nil {
			f.Changed = false
			f.Value.Set("")
		}
	}
}

// boardClaimSuccessResponse returns a minimal valid claimItem API response.
func boardClaimSuccessResponse() []byte {
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

// executeBoardClaim runs the claimItem command with the given args against the
// mock server. Returns stdout output and any error. Mirrors executeAgentStart's
// structure (see agents-start_agentStart_test.go).
func executeBoardClaim(t *testing.T, serverURL string, extraArgs ...string) (string, error) {
	t.Helper()
	// Reset flag state before AND after: cobra keeps Changed() and module
	// variables on the shared rootCmd, so prior tests would otherwise leak.
	resetBoardClaimClaimItemFlagsForTest()
	t.Cleanup(resetBoardClaimClaimItemFlagsForTest)
	var buf bytes.Buffer
	rootCmd.SetOut(&buf)
	rootCmd.SetErr(&buf)

	baseArgs := []string{
		"board-claim", "claimItem",
		"--base-url", serverURL,
		"--itemId", "WI-001",
		"--agent", "Murdock",
		"--no-color",
	}
	rootCmd.SetArgs(append(baseArgs, extraArgs...))
	err := rootCmd.Execute()
	return buf.String(), err
}

// TestBoardClaimAcceptsPipelineAgent is the positive control: a pipeline agent
// passes the client-side validate.Enum check and the request reaches the mock
// server. Without it, the rejection tests below could pass vacuously (e.g. if
// the harness itself were broken and no request ever reached the server).
func TestBoardClaimAcceptsPipelineAgent(t *testing.T) {
	requestReceived := false
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestReceived = true
		w.Header().Set("Content-Type", "application/json")
		w.Write(boardClaimSuccessResponse())
	}))
	defer srv.Close()

	_, err := executeBoardClaim(t, srv.URL, "--agent", "Murdock")
	if err != nil {
		t.Fatalf("unexpected error validating --agent Murdock: %v", err)
	}
	if !requestReceived {
		t.Error("expected the mock server to receive the request, but client-side validation blocked it before the HTTP call")
	}
}

// TestBoardClaimRejectsFrankie pins the intent of ADR 0005: Frankie never
// claims board items (`done` is terminal), so even though the openapi.yaml
// AgentName enum includes him, the claimItem allowed-list deliberately does
// not. The rejection must happen client-side — the mock server must never see
// a request.
func TestBoardClaimRejectsFrankie(t *testing.T) {
	requestReceived := false
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestReceived = true
		w.Header().Set("Content-Type", "application/json")
		w.Write(boardClaimSuccessResponse())
	}))
	defer srv.Close()

	_, err := executeBoardClaim(t, srv.URL, "--agent", "Frankie")
	if err == nil {
		t.Fatal("expected an error for --agent Frankie (ADR 0005: Frankie never claims board items), got nil")
	}
	if requestReceived {
		t.Error("expected client-side validation to reject Frankie before any HTTP call, but the mock server received a request")
	}
}

// TestBoardClaimRejectsSosa pins the resolved help-text mismatch: Sosa is a
// planning-phase critic who never claims board items, and the allowed-list
// (now matched by the flag help and completion) rejects her client-side.
func TestBoardClaimRejectsSosa(t *testing.T) {
	requestReceived := false
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestReceived = true
		w.Header().Set("Content-Type", "application/json")
		w.Write(boardClaimSuccessResponse())
	}))
	defer srv.Close()

	_, err := executeBoardClaim(t, srv.URL, "--agent", "Sosa")
	if err == nil {
		t.Fatal("expected an error for --agent Sosa, got nil")
	}
	if requestReceived {
		t.Error("expected client-side validation to reject Sosa before any HTTP call, but the mock server received a request")
	}
}
