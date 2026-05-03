package cmd

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// healthReportResponse returns a minimal valid getHealthReport API response.
func healthReportResponse() []byte {
	resp := map[string]interface{}{
		"success": true,
		"data": map[string]interface{}{
			"missionId":       "M-20260502-test",
			"overallHealth":   "healthy",
			"itemsTotal":      10,
			"itemsDone":       7,
			"itemsBlocked":    0,
			"rejectionsTotal": 1,
			"stages": map[string]interface{}{
				"testing":      1,
				"implementing": 2,
				"review":       0,
			},
		},
	}
	b, _ := json.Marshal(resp)
	return b
}

// executeGetHealthReport runs the missions-health getHealthReport command against
// the mock server. The --json flag may be omitted by passing withJSON=false so we
// can exercise the table/raw fallback path.
func executeGetHealthReport(t *testing.T, serverURL string, withJSON bool) (string, error) {
	t.Helper()
	var buf bytes.Buffer
	rootCmd.SetOut(&buf)
	rootCmd.SetErr(&buf)

	args := []string{
		"missions-health", "getHealthReport",
		"--base-url", serverURL,
		"--no-color",
	}
	if withJSON {
		args = append(args, "--json")
	}
	rootCmd.SetArgs(args)
	err := rootCmd.Execute()
	return buf.String(), err
}

// TestMissionsHealthGetHealthReportSendsGetToCorrectPath verifies the command
// issues a GET request to /api/missions/current/health-report.
func TestMissionsHealthGetHealthReportSendsGetToCorrectPath(t *testing.T) {
	t.Setenv("ATEAM_PROJECT_ID", "test-project")

	var capturedMethod string
	var capturedPath string
	var capturedQuery string
	var capturedBodyLen int
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capturedMethod = r.Method
		capturedPath = r.URL.Path
		capturedQuery = r.URL.RawQuery
		raw, _ := io.ReadAll(r.Body)
		capturedBodyLen = len(raw)
		w.Header().Set("Content-Type", "application/json")
		w.Write(healthReportResponse())
	}))
	defer srv.Close()

	_, err := executeGetHealthReport(t, srv.URL, true)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if capturedMethod != http.MethodGet {
		t.Errorf("expected GET, got %s", capturedMethod)
	}
	const expectedPath = "/api/missions/current/health-report"
	if capturedPath != expectedPath {
		t.Errorf("expected path %q, got %q", expectedPath, capturedPath)
	}
	if capturedQuery != "" {
		t.Errorf("expected no query string, got %q", capturedQuery)
	}
	if capturedBodyLen != 0 {
		t.Errorf("expected empty request body, got %d bytes", capturedBodyLen)
	}
}

// TestMissionsHealthGetHealthReportSendsProjectIDHeader verifies the
// X-Project-ID header is set from ATEAM_PROJECT_ID by the shared HTTP client.
func TestMissionsHealthGetHealthReportSendsProjectIDHeader(t *testing.T) {
	t.Setenv("ATEAM_PROJECT_ID", "proj-health-42")

	var capturedHeader string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capturedHeader = r.Header.Get("X-Project-ID")
		w.Header().Set("Content-Type", "application/json")
		w.Write(healthReportResponse())
	}))
	defer srv.Close()

	_, err := executeGetHealthReport(t, srv.URL, true)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if capturedHeader != "proj-health-42" {
		t.Errorf("expected X-Project-ID=%q, got %q", "proj-health-42", capturedHeader)
	}
}

// TestMissionsHealthGetHealthReportJSONPrintsRawBody verifies that --json
// causes the exact API response bytes to be written to stdout.
func TestMissionsHealthGetHealthReportJSONPrintsRawBody(t *testing.T) {
	t.Setenv("ATEAM_PROJECT_ID", "test-project")
	body := healthReportResponse()

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write(body)
	}))
	defer srv.Close()

	output, err := executeGetHealthReport(t, srv.URL, true)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if !strings.Contains(output, string(body)) {
		t.Errorf("expected raw response body in stdout under --json, got: %s", output)
	}
}

// TestMissionsHealthGetHealthReportTableFallbackContainsData verifies that
// without --json the command produces output containing the response data
// (either via a rendered table or the raw JSON fallback).
func TestMissionsHealthGetHealthReportTableFallbackContainsData(t *testing.T) {
	t.Setenv("ATEAM_PROJECT_ID", "test-project")

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write(healthReportResponse())
	}))
	defer srv.Close()

	output, err := executeGetHealthReport(t, srv.URL, false)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// The mission ID should be present whether the data is rendered as a
	// table or dumped as raw JSON — both paths must surface the payload.
	if !strings.Contains(output, "M-20260502-test") {
		t.Errorf("expected response data (missionId) in non-JSON output, got: %s", output)
	}
}

// TestMissionsHealthGetHealthReportNon2xxReturnsError verifies that a 500 from
// the API causes the command to return a non-nil error from RunE.
func TestMissionsHealthGetHealthReportNon2xxReturnsError(t *testing.T) {
	t.Setenv("ATEAM_PROJECT_ID", "test-project")

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		resp := map[string]interface{}{
			"success": false,
			"error": map[string]interface{}{
				"code":    "INTERNAL_ERROR",
				"message": "health report unavailable",
			},
		}
		b, _ := json.Marshal(resp)
		w.Write(b)
	}))
	defer srv.Close()

	_, err := executeGetHealthReport(t, srv.URL, true)
	if err == nil {
		t.Fatal("expected non-nil error for 500 response, got nil")
	}
}
