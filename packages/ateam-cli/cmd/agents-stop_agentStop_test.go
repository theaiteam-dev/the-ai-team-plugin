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

// wipExceededResponse returns the REAL shape /api/agents/stop emits when the
// target stage is at WIP capacity: HTTP 200, the work log entry persisted, and
// the skipped transition signalled via data.wipExceeded + data.blockedStage.
// The endpoint never returns a WIP_LIMIT_EXCEEDED error envelope — only
// /api/agents/start does.
func wipExceededResponse() []byte {
	resp := map[string]interface{}{
		"success": true,
		"data": map[string]interface{}{
			"itemId":       "WI-001",
			"agent":        "Murdock",
			"wipExceeded":  true,
			"blockedStage": "implementing",
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

// captureStderr redirects os.Stderr for the duration of the test (the command
// writes its WIP/pool warnings there directly, not through cobra's out/err
// writers). The returned func stops capturing and yields what was written.
func captureStderr(t *testing.T) func() string {
	t.Helper()
	orig := os.Stderr
	r, w, err := os.Pipe()
	if err != nil {
		t.Fatalf("os.Pipe: %v", err)
	}
	os.Stderr = w
	restored := false
	restore := func() {
		if restored {
			return
		}
		restored = true
		os.Stderr = orig
		_ = w.Close()
	}
	t.Cleanup(restore)
	return func() string {
		restore()
		buf := make([]byte, 8192)
		n, _ := r.Read(buf)
		return string(buf[:n])
	}
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

// TestAgentStopWipExceededSurfacesWarningWithoutError pins the REAL contract of
// POST /api/agents/stop under WIP pressure: HTTP 200 with data.wipExceeded, work
// already logged, item NOT advanced. The command must succeed (the stop itself
// worked) while surfacing an actionable warning naming the blocked stage.
func TestAgentStopWipExceededSurfacesWarningWithoutError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write(wipExceededResponse()) // 200, not 409
	}))
	defer srv.Close()

	readStderr := captureStderr(t)
	out, err := executeAgentStop(t, srv.URL)
	stderr := readStderr()

	// The stop succeeded — only the stage transition was skipped, so returning
	// an error here would make agents treat logged work as unrecorded.
	if err != nil {
		t.Fatalf("expected no error on a 200 wipExceeded response, got: %v (output: %s)", err, out)
	}
	for _, want := range []string{"WIP_LIMIT_EXCEEDED", "implementing", "NOT advanced", "ALERT to Hannibal"} {
		if !strings.Contains(stderr, want) {
			t.Errorf("expected %q in the WIP warning, got: %s", want, stderr)
		}
	}
	// Retrying with --advance=false would double-log the work the API already
	// recorded — the warning must never suggest it on this path.
	if strings.Contains(stderr, "--advance=false") {
		t.Errorf("WIP warning must not advise retrying with --advance=false (work is already logged), got: %s", stderr)
	}
}

// TestAgentStopWipExceededSkipsNextAgentClaim verifies the pool consequence of
// the same 200-with-wipExceeded response: because the item did NOT advance,
// there is no handoff, so the downstream instance must be left idle rather than
// claimed and stranded.
func TestAgentStopWipExceededSkipsNextAgentClaim(t *testing.T) {
	_, poolDir := withTempPoolRoot(t, "agentstop-wip-noclaim")
	if err := os.MkdirAll(poolDir, 0755); err != nil {
		t.Fatalf("mkdir pool: %v", err)
	}
	idleMarker := filepath.Join(poolDir, "ba-1.idle")
	if err := os.WriteFile(idleMarker, []byte("a729de7264069a126"), 0644); err != nil {
		t.Fatalf("writing idle marker: %v", err)
	}

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write(wipExceededResponse())
	}))
	defer srv.Close()

	readStderr := captureStderr(t)
	_, err := executeAgentStop(t, srv.URL)
	_ = readStderr()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if _, statErr := os.Stat(idleMarker); statErr != nil {
		t.Errorf("expected ba-1 to stay idle when the item did not advance, but the marker is gone: %v", statErr)
	}
	if _, statErr := os.Stat(filepath.Join(poolDir, "ba-1.busy")); statErr == nil {
		t.Error("expected no next-agent claim on the wipExceeded path, but ba-1 was marked busy")
	}
}
