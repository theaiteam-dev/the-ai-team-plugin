package cmd

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
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

// executeBoardClaimRawBody runs claimItem with a raw --body (or --body-file,
// via bodyFlag) instead of the individual --agent/--itemId flags, bypassing
// the baseArgs helper in executeBoardClaim which always sets --agent/--itemId.
func executeBoardClaimRawBody(t *testing.T, serverURL string, bodyFlag string, bodyVal string) (string, error) {
	t.Helper()
	resetBoardClaimClaimItemFlagsForTest()
	t.Cleanup(resetBoardClaimClaimItemFlagsForTest)
	var buf bytes.Buffer
	rootCmd.SetOut(&buf)
	rootCmd.SetErr(&buf)

	rootCmd.SetArgs([]string{
		"board-claim", "claimItem",
		"--base-url", serverURL,
		"--no-color",
		bodyFlag, bodyVal,
	})
	err := rootCmd.Execute()
	return buf.String(), err
}

// TestBoardClaimRawBodyRejectsFrankie is CodeRabbit's PR #55 finding on
// board-claim_claimItem.go ~lines 40-46: the raw-body branch used to return
// before validate.RequireFlags/validate.Enum ran, so a --body containing an
// excluded agent (Frankie — ADR 0005, `done` is terminal) reached the API
// unvalidated. The same allowed-agent check the flag path uses must now run
// client-side before c.Do, and the mock server must never see a request.
func TestBoardClaimRawBodyRejectsFrankie(t *testing.T) {
	requestReceived := false
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestReceived = true
		w.Header().Set("Content-Type", "application/json")
		w.Write(boardClaimSuccessResponse())
	}))
	defer srv.Close()

	_, err := executeBoardClaimRawBody(t, srv.URL, "--body", `{"itemId":"WI-1","agent":"Frankie"}`)
	if err == nil {
		t.Fatal("expected an error for --body with agent Frankie, got nil")
	}
	for _, want := range []string{"Hannibal", "Face", "Murdock", "B.A.", "Amy", "Lynch", "Stockwell", "Tawnia"} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("expected error to mention allowed agents (e.g. %q), got: %v", want, err)
		}
	}
	if requestReceived {
		t.Error("expected client-side validation to reject Frankie before any HTTP call, but the mock server received a request")
	}
}

// TestBoardClaimRawBodyFileRejectsSosa is the --body-file variant of the same
// CodeRabbit finding: file-sourced bodies funnel through the same code path
// as --body (both land in boardClaimClaimItemCmdBody), so an excluded agent
// read from a file must be rejected client-side too.
func TestBoardClaimRawBodyFileRejectsSosa(t *testing.T) {
	requestReceived := false
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestReceived = true
		w.Header().Set("Content-Type", "application/json")
		w.Write(boardClaimSuccessResponse())
	}))
	defer srv.Close()

	dir := t.TempDir()
	bodyPath := filepath.Join(dir, "body.json")
	if err := os.WriteFile(bodyPath, []byte(`{"itemId":"WI-1","agent":"Sosa"}`), 0644); err != nil {
		t.Fatalf("writing body-file fixture: %v", err)
	}

	_, err := executeBoardClaimRawBody(t, srv.URL, "--body-file", bodyPath)
	if err == nil {
		t.Fatal("expected an error for --body-file with agent Sosa, got nil")
	}
	if requestReceived {
		t.Error("expected client-side validation to reject Sosa before any HTTP call, but the mock server received a request")
	}
}

// TestBoardClaimRawBodyMissingAgentRejectedClientSide covers a --body that
// omits the "agent" field entirely: there is nothing to validate against the
// allowed-agent list, so this must fail client-side with a clear error rather
// than reach the server (where the API would presumably 400 anyway, but the
// contract here is that agent-policy enforcement never depends on the API).
func TestBoardClaimRawBodyMissingAgentRejectedClientSide(t *testing.T) {
	requestReceived := false
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestReceived = true
		w.Header().Set("Content-Type", "application/json")
		w.Write(boardClaimSuccessResponse())
	}))
	defer srv.Close()

	_, err := executeBoardClaimRawBody(t, srv.URL, "--body", `{"itemId":"WI-1"}`)
	if err == nil {
		t.Fatal("expected an error for --body missing the agent field, got nil")
	}
	if requestReceived {
		t.Error("expected client-side validation to reject a missing agent field before any HTTP call, but the mock server received a request")
	}
}

// TestBoardClaimRawBodyMalformedJSONRejectedClientSide covers malformed JSON
// passed via --body: it must fail client-side (json.Valid already catches
// this), never reach the server.
func TestBoardClaimRawBodyMalformedJSONRejectedClientSide(t *testing.T) {
	requestReceived := false
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestReceived = true
		w.Header().Set("Content-Type", "application/json")
		w.Write(boardClaimSuccessResponse())
	}))
	defer srv.Close()

	_, err := executeBoardClaimRawBody(t, srv.URL, "--body", `{"itemId":"WI-1","agent":`)
	if err == nil {
		t.Fatal("expected an error for malformed JSON --body, got nil")
	}
	if requestReceived {
		t.Error("expected client-side validation to reject malformed JSON before any HTTP call, but the mock server received a request")
	}
}

// TestBoardClaimRawBodyAllowedAgentSucceedsByteIdentical is the positive
// control for the raw-body validation path: a body with an allowed agent
// still reaches the server, and the bytes the server receives are byte-for-
// byte identical to what the caller passed via --body (proving the fix
// validates without re-serializing).
func TestBoardClaimRawBodyAllowedAgentSucceedsByteIdentical(t *testing.T) {
	const rawBody = `{"itemId":"WI-1","agent":"Murdock"}`
	var receivedBody []byte
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var err error
		receivedBody, err = io.ReadAll(r.Body)
		if err != nil {
			t.Fatalf("reading request body on mock server: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write(boardClaimSuccessResponse())
	}))
	defer srv.Close()

	_, err := executeBoardClaimRawBody(t, srv.URL, "--body", rawBody)
	if err != nil {
		t.Fatalf("unexpected error for --body with allowed agent Murdock: %v", err)
	}
	if string(receivedBody) != rawBody {
		t.Errorf("expected request body to be byte-identical to --body input\nwant: %s\ngot:  %s", rawBody, string(receivedBody))
	}
}
