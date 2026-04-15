package cmd

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// createMissionSuccessResponse returns a minimal valid createMission API response.
func createMissionSuccessResponse() []byte {
	resp := map[string]interface{}{
		"success": true,
		"data": map[string]interface{}{
			"id":   "M-20260401-test",
			"name": "Test Mission",
		},
	}
	b, _ := json.Marshal(resp)
	return b
}

// executeCreateMission runs the createMission command with the given args against the mock server.
func executeCreateMission(t *testing.T, serverURL string, extraArgs ...string) (string, error) {
	t.Helper()
	// Reset flag state before AND after: cobra keeps Changed() and module
	// variables on the shared rootCmd, so prior tests would otherwise leak.
	resetMissionsCreateMissionFlagsForTest()
	t.Cleanup(resetMissionsCreateMissionFlagsForTest)
	var buf bytes.Buffer
	rootCmd.SetOut(&buf)
	rootCmd.SetErr(&buf)

	baseArgs := []string{
		"missions", "createMission",
		"--base-url", serverURL,
		"--name", "Test Mission",
		"--prdPath", "prd/test.md",
		"--no-color",
	}
	rootCmd.SetArgs(append(baseArgs, extraArgs...))
	err := rootCmd.Execute()
	return buf.String(), err
}

// TestCreateMissionConcurrencySendsOverrideInBody verifies that --concurrency N
// sends concurrencyOverride: N in the POST body.
func TestCreateMissionConcurrencySendsOverrideInBody(t *testing.T) {
	var capturedBody map[string]interface{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capturedBody = captureBody(t, r)
		w.Header().Set("Content-Type", "application/json")
		w.Write(createMissionSuccessResponse())
	}))
	defer srv.Close()

	_, err := executeCreateMission(t, srv.URL, "--concurrency", "3")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	override, ok := capturedBody["concurrencyOverride"]
	if !ok {
		t.Fatal("expected 'concurrencyOverride' field in request body, but it was missing")
	}
	// JSON numbers decode as float64
	if override != float64(3) {
		t.Errorf("expected concurrencyOverride=3, got %v", override)
	}
}

// TestCreateMissionNoConcurrencyFlagOmitsOrSendsZero verifies that omitting
// --concurrency does not send a non-zero concurrencyOverride (adaptive scaling applies).
func TestCreateMissionNoConcurrencyFlagOmitsOrSendsZero(t *testing.T) {
	var capturedBody map[string]interface{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capturedBody = captureBody(t, r)
		w.Header().Set("Content-Type", "application/json")
		w.Write(createMissionSuccessResponse())
	}))
	defer srv.Close()

	_, err := executeCreateMission(t, srv.URL)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// When not provided, concurrencyOverride must be absent or zero (no manual override).
	if override, ok := capturedBody["concurrencyOverride"]; ok {
		if override != float64(0) && override != nil {
			t.Errorf("expected concurrencyOverride to be absent or 0 when flag not set, got %v", override)
		}
	}
}

// TestCreateMissionConcurrencyZeroIsInvalid verifies that --concurrency 0 returns
// a validation error without hitting the server (must be >= 1 when provided).
func TestCreateMissionConcurrencyZeroIsInvalid(t *testing.T) {
	serverCalled := false
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		serverCalled = true
		w.Header().Set("Content-Type", "application/json")
		w.Write(createMissionSuccessResponse())
	}))
	defer srv.Close()

	_, err := executeCreateMission(t, srv.URL, "--concurrency", "0")

	if serverCalled {
		t.Error("expected validation to fail before reaching the server, but server was called")
	}
	if err == nil {
		t.Error("expected an error for --concurrency 0, but got none")
	}
}

// TestCreateMissionConcurrencyDoubleInvocationPicksUpNewValues verifies that
// invoking the command twice in the same test with different --concurrency
// values picks up the second invocation's value, not the first. Issue #12:
// previously the production RunE manually reset cobra flag state, which
// coupled tests to that cleanup. With the reset moved to test helpers, the
// in-test helper must correctly isolate invocations.
func TestCreateMissionConcurrencyDoubleInvocationPicksUpNewValues(t *testing.T) {
	var capturedBodies []map[string]interface{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capturedBodies = append(capturedBodies, captureBody(t, r))
		w.Header().Set("Content-Type", "application/json")
		w.Write(createMissionSuccessResponse())
	}))
	defer srv.Close()

	if _, err := executeCreateMission(t, srv.URL, "--concurrency", "7"); err != nil {
		t.Fatalf("first invocation: unexpected error: %v", err)
	}
	if _, err := executeCreateMission(t, srv.URL, "--concurrency", "2"); err != nil {
		t.Fatalf("second invocation: unexpected error: %v", err)
	}

	if len(capturedBodies) != 2 {
		t.Fatalf("expected 2 requests, got %d", len(capturedBodies))
	}
	if got := capturedBodies[0]["concurrencyOverride"]; got != float64(7) {
		t.Errorf("first call: expected concurrencyOverride=7, got %v", got)
	}
	if got := capturedBodies[1]["concurrencyOverride"]; got != float64(2) {
		t.Errorf("second call: expected concurrencyOverride=2 (not stale 7), got %v", got)
	}
}

// TestCreateMissionConcurrencyNegativeIsInvalid verifies that negative values
// are rejected with a validation error.
func TestCreateMissionConcurrencyNegativeIsInvalid(t *testing.T) {
	serverCalled := false
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		serverCalled = true
		w.Header().Set("Content-Type", "application/json")
		w.Write(createMissionSuccessResponse())
	}))
	defer srv.Close()

	_, err := executeCreateMission(t, srv.URL, "--concurrency", "-1")

	if serverCalled {
		t.Error("expected validation to fail before reaching the server, but server was called")
	}
	if err == nil {
		t.Error("expected an error for --concurrency -1, but got none")
	}
}
