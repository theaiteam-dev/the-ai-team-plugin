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

// captureBody reads the request body sent to the mock server.
func captureBody(t *testing.T, r *http.Request) map[string]interface{} {
	t.Helper()
	raw, err := io.ReadAll(r.Body)
	if err != nil {
		t.Fatalf("reading request body: %v", err)
	}
	var body map[string]interface{}
	if err := json.Unmarshal(raw, &body); err != nil {
		t.Fatalf("parsing request body: %v", err)
	}
	return body
}

// successResponse returns a minimal valid agentStop API response.
func successResponse() []byte {
	resp := map[string]interface{}{
		"success": true,
		"data": map[string]interface{}{
			"itemId":    "WI-001",
			"agent":     "Murdock",
			"nextStage": "implementing",
			"workLogEntry": map[string]interface{}{
				"id":        1,
				"agent":     "Murdock",
				"action":    "completed",
				"summary":   "Tests written",
				"timestamp": "2026-01-21T14:00:00Z",
			},
		},
	}
	b, _ := json.Marshal(resp)
	return b
}

// wipLimitExceededResponse returns a 409 WIP_LIMIT_EXCEEDED API error body.
func wipLimitExceededResponse() []byte {
	resp := map[string]interface{}{
		"success": false,
		"error": map[string]interface{}{
			"code":    "WIP_LIMIT_EXCEEDED",
			"message": "WIP limit exceeded for stage implementing (limit: 3, current: 3)",
			"details": map[string]interface{}{
				"stageId": "implementing",
				"limit":   3,
				"current": 3,
			},
		},
	}
	b, _ := json.Marshal(resp)
	return b
}

// executeAgentStop runs the agentStop command with the given args against the mock server.
// Returns stdout output and any error.
func executeAgentStop(t *testing.T, serverURL string, extraArgs ...string) (string, error) {
	t.Helper()
	// Reset flag state before AND after: cobra keeps Changed() and module
	// variables on the shared rootCmd, so prior tests would otherwise leak.
	resetAgentsStopAgentStopFlagsForTest()
	t.Cleanup(resetAgentsStopAgentStopFlagsForTest)
	var buf bytes.Buffer
	rootCmd.SetOut(&buf)
	rootCmd.SetErr(&buf)

	baseArgs := []string{
		"agents-stop", "agentStop",
		"--base-url", serverURL,
		"--itemId", "WI-001",
		"--agent", "Murdock",
		"--summary", "Tests written",
		"--no-color",
	}
	rootCmd.SetArgs(append(baseArgs, extraArgs...))
	err := rootCmd.Execute()
	return buf.String(), err
}

// TestAgentStopAdvanceDefaultSendsTrue verifies the default advance=true is sent
// to preserve backward-compatible behavior.
func TestAgentStopAdvanceDefaultSendsTrue(t *testing.T) {
	var capturedBody map[string]interface{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capturedBody = captureBody(t, r)
		w.Header().Set("Content-Type", "application/json")
		w.Write(successResponse())
	}))
	defer srv.Close()

	_, err := executeAgentStop(t, srv.URL)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	advance, ok := capturedBody["advance"]
	if !ok {
		t.Fatal("expected 'advance' field in request body, but it was missing")
	}
	if advance != true {
		t.Errorf("expected advance=true by default, got %v", advance)
	}
}

// TestAgentStopAdvanceFalseSendsFalse verifies --advance=false sends advance:false in body,
// which tells the API to skip the stage transition.
func TestAgentStopAdvanceFalseSendsFalse(t *testing.T) {
	var capturedBody map[string]interface{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capturedBody = captureBody(t, r)
		w.Header().Set("Content-Type", "application/json")
		w.Write(successResponse())
	}))
	defer srv.Close()

	_, err := executeAgentStop(t, srv.URL, "--advance=false")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	advance, ok := capturedBody["advance"]
	if !ok {
		t.Fatal("expected 'advance' field in request body, but it was missing")
	}
	if advance != false {
		t.Errorf("expected advance=false, got %v", advance)
	}
}

// TestAgentStopAcceptsFrankie verifies the client-side validate.Enum allowed-list
// includes Frankie: the request must actually reach the mock server rather than
// being rejected locally before any HTTP call (WI-774 AC6).
func TestAgentStopAcceptsFrankie(t *testing.T) {
	requestReceived := false
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestReceived = true
		w.Header().Set("Content-Type", "application/json")
		w.Write(successResponse())
	}))
	defer srv.Close()

	_, err := executeAgentStop(t, srv.URL, "--agent", "Frankie")
	if err != nil {
		t.Fatalf("unexpected error validating --agent Frankie: %v", err)
	}
	if !requestReceived {
		t.Error("expected the mock server to receive the request, but client-side validation blocked it before the HTTP call")
	}
}

// TestAgentStopRejectsUnknownAgent verifies an unrecognised --agent value is still
// rejected by the client-side validate.Enum check, and never reaches the server
// (WI-774 AC6's negative counterpart).
func TestAgentStopRejectsUnknownAgent(t *testing.T) {
	requestReceived := false
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestReceived = true
		w.Header().Set("Content-Type", "application/json")
		w.Write(successResponse())
	}))
	defer srv.Close()

	_, err := executeAgentStop(t, srv.URL, "--agent", "NotAnAgent")
	if err == nil {
		t.Fatal("expected an error for --agent NotAnAgent, got nil")
	}
	if requestReceived {
		t.Error("expected client-side validation to reject before any HTTP call, but the mock server received a request")
	}
}

// TestHandlePoolManagementReturnsNextAgentID verifies the forward handoff: a
// completing Murdock claims the downstream B.A. instance from the pool and gets
// back both the instance name AND its recorded agentId, so the START handoff can
// be addressed by agentId (name-addressing does not route between teammates in
// headless -p mode).
func TestHandlePoolManagementReturnsNextAgentID(t *testing.T) {
	_, poolDir := withTempPoolRoot(t, "handlepool-agentid")
	if err := os.MkdirAll(poolDir, 0755); err != nil {
		t.Fatalf("mkdir pool: %v", err)
	}
	if err := os.WriteFile(filepath.Join(poolDir, "ba-1.idle"), []byte("a729de7264069a126"), 0644); err != nil {
		t.Fatalf("writing idle marker: %v", err)
	}

	next, nextID, alert := handlePoolManagement("Murdock", "completed", true)
	if next != "ba-1" {
		t.Errorf("expected claimedNext=ba-1, got %q", next)
	}
	if nextID != "a729de7264069a126" {
		t.Errorf("expected claimedNextAgentId to be read from the marker, got %q", nextID)
	}
	if alert != "" {
		t.Errorf("expected no poolAlert when an idle instance exists, got %q", alert)
	}
}

// TestInjectPoolResultAddsClaimedNextAgentID verifies claimedNextAgentId is merged
// into the response data alongside claimedNext.
func TestInjectPoolResultAddsClaimedNextAgentID(t *testing.T) {
	resp := []byte(`{"success":true,"data":{"itemId":"WI-001"}}`)
	out := injectPoolResult(resp, "ba-1", "a729de7264069a126", "")

	var parsed struct {
		Data struct {
			ClaimedNext        string `json:"claimedNext"`
			ClaimedNextAgentID string `json:"claimedNextAgentId"`
		} `json:"data"`
	}
	if err := json.Unmarshal(out, &parsed); err != nil {
		t.Fatalf("unmarshal: %v\nraw: %s", err, out)
	}
	if parsed.Data.ClaimedNext != "ba-1" {
		t.Errorf("expected claimedNext=ba-1, got %q", parsed.Data.ClaimedNext)
	}
	if parsed.Data.ClaimedNextAgentID != "a729de7264069a126" {
		t.Errorf("expected claimedNextAgentId to surface, got %q", parsed.Data.ClaimedNextAgentID)
	}
}

// TestInjectPoolResultOmitsAgentIDWhenEmpty verifies backward compatibility: with
// no agentId (marker was empty / --agent-id omitted), the key is absent and the
// name-only claimedNext is still present — identical to pre-change behavior.
func TestInjectPoolResultOmitsAgentIDWhenEmpty(t *testing.T) {
	resp := []byte(`{"success":true,"data":{"itemId":"WI-001"}}`)
	out := injectPoolResult(resp, "ba-1", "", "")

	if strings.Contains(string(out), "claimedNextAgentId") {
		t.Errorf("expected no claimedNextAgentId key when agentId is empty, got %s", out)
	}
	if !strings.Contains(string(out), `"claimedNext":"ba-1"`) {
		t.Errorf("expected claimedNext still present, got %s", out)
	}
}

// TestAgentStopWipLimitExceededDisplayedDistinctly verifies that a WIP_LIMIT_EXCEEDED
// response from the API is surfaced with an actionable message — not just a raw JSON dump —
// so agents know to retry with --advance=false to skip the stage transition.
func TestAgentStopWipLimitExceededDisplayedDistinctly(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusConflict) // 409
		w.Write(wipLimitExceededResponse())
	}))
	defer srv.Close()

	output, err := executeAgentStop(t, srv.URL)
	combined := output + err.Error()

	// The error must surface the WIP_LIMIT_EXCEEDED code AND hint that --advance=false
	// is the escape hatch, so agents can act without waiting for Hannibal.
	if !strings.Contains(combined, "WIP_LIMIT_EXCEEDED") {
		t.Errorf("expected WIP_LIMIT_EXCEEDED in error output, got: %s", combined)
	}
	if !strings.Contains(combined, "--advance=false") {
		t.Errorf("expected '--advance=false' hint in WIP error output, got: %s", combined)
	}
}
