package cmd

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// scalingComputeSuccessResponse returns a minimal valid scaling compute API response.
func scalingComputeSuccessResponse() []byte {
	resp := map[string]interface{}{
		"success": true,
		"data": map[string]interface{}{
			"concurrency": 3,
			"memoryMB":    8192,
		},
	}
	b, _ := json.Marshal(resp)
	return b
}

// executeScalingCompute runs the `scaling compute` command against the mock server.
func executeScalingCompute(t *testing.T, serverURL string, extraArgs ...string) (string, error) {
	t.Helper()
	// Reset before AND after: cobra keeps Changed() state on the shared rootCmd.
	resetScalingComputeFlagsForTest()
	t.Cleanup(resetScalingComputeFlagsForTest)
	var buf bytes.Buffer
	rootCmd.SetOut(&buf)
	rootCmd.SetErr(&buf)

	baseArgs := []string{
		"scaling", "compute",
		"--base-url", serverURL,
		"--no-color",
	}
	rootCmd.SetArgs(append(baseArgs, extraArgs...))
	err := rootCmd.Execute()
	return buf.String(), err
}

// TestScalingComputeSendsConcurrencyOverride verifies the flag is forwarded.
func TestScalingComputeSendsConcurrencyOverride(t *testing.T) {
	var capturedBody map[string]interface{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capturedBody = captureBody(t, r)
		w.Header().Set("Content-Type", "application/json")
		w.Write(scalingComputeSuccessResponse())
	}))
	defer srv.Close()

	if _, err := executeScalingCompute(t, srv.URL, "--concurrency", "5"); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got := capturedBody["concurrencyOverride"]; got != float64(5) {
		t.Errorf("expected concurrencyOverride=5, got %v", got)
	}
}

// TestScalingComputeOmitsConcurrencyWhenUnset verifies absent flag → absent field.
func TestScalingComputeOmitsConcurrencyWhenUnset(t *testing.T) {
	var capturedBody map[string]interface{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capturedBody = captureBody(t, r)
		w.Header().Set("Content-Type", "application/json")
		w.Write(scalingComputeSuccessResponse())
	}))
	defer srv.Close()

	if _, err := executeScalingCompute(t, srv.URL); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if _, ok := capturedBody["concurrencyOverride"]; ok {
		t.Errorf("expected concurrencyOverride to be omitted when flag unset, got %v", capturedBody["concurrencyOverride"])
	}
}

// TestScalingComputeDoubleInvocationPicksUpNewValues verifies that invoking
// the command twice with different flag values picks up the second value.
// Issue #12: production RunE no longer resets flag state — so test isolation
// must work correctly via resetScalingComputeFlagsForTest.
func TestScalingComputeDoubleInvocationPicksUpNewValues(t *testing.T) {
	var capturedBodies []map[string]interface{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capturedBodies = append(capturedBodies, captureBody(t, r))
		w.Header().Set("Content-Type", "application/json")
		w.Write(scalingComputeSuccessResponse())
	}))
	defer srv.Close()

	if _, err := executeScalingCompute(t, srv.URL, "--concurrency", "8"); err != nil {
		t.Fatalf("first invocation: unexpected error: %v", err)
	}
	if _, err := executeScalingCompute(t, srv.URL, "--concurrency", "2"); err != nil {
		t.Fatalf("second invocation: unexpected error: %v", err)
	}

	if len(capturedBodies) != 2 {
		t.Fatalf("expected 2 requests, got %d", len(capturedBodies))
	}
	if got := capturedBodies[0]["concurrencyOverride"]; got != float64(8) {
		t.Errorf("first call: expected concurrencyOverride=8, got %v", got)
	}
	if got := capturedBodies[1]["concurrencyOverride"]; got != float64(2) {
		t.Errorf("second call: expected concurrencyOverride=2 (not stale 8), got %v", got)
	}
}

// TestScalingComputeConcurrencyZeroIsInvalid verifies validation error on 0.
func TestScalingComputeConcurrencyZeroIsInvalid(t *testing.T) {
	serverCalled := false
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		serverCalled = true
		w.Header().Set("Content-Type", "application/json")
		w.Write(scalingComputeSuccessResponse())
	}))
	defer srv.Close()

	_, err := executeScalingCompute(t, srv.URL, "--concurrency", "0")
	if serverCalled {
		t.Error("expected validation to fail before server call")
	}
	if err == nil {
		t.Error("expected error for --concurrency 0")
	}
}
