package cmd

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// retroSuccessResponse returns a minimal valid writeRetro API response.
func retroSuccessResponse(missionId string) []byte {
	resp := map[string]interface{}{
		"success": true,
		"data": map[string]interface{}{
			"missionId": missionId,
		},
	}
	b, _ := json.Marshal(resp)
	return b
}

// retroGetResponse returns a getRetro API response with the given report.
func retroGetResponse(missionId, report string) []byte {
	resp := map[string]interface{}{
		"success": true,
		"data": map[string]interface{}{
			"missionId":    missionId,
			"retroReport":  report,
		},
	}
	b, _ := json.Marshal(resp)
	return b
}

// executeWriteRetro runs the writeRetro command against the mock server.
func executeWriteRetro(t *testing.T, serverURL, missionId, report string) (string, error) {
	t.Helper()
	var buf bytes.Buffer
	rootCmd.SetOut(&buf)
	rootCmd.SetErr(&buf)
	rootCmd.SetArgs([]string{
		"missions-retro", "writeRetro",
		"--base-url", serverURL,
		"--missionId", missionId,
		"--report", report,
		"--no-color",
	})
	err := rootCmd.Execute()
	return buf.String(), err
}

// executeGetRetro runs the getRetro command against the mock server.
func executeGetRetro(t *testing.T, serverURL, missionId string) (string, error) {
	t.Helper()
	var buf bytes.Buffer
	rootCmd.SetOut(&buf)
	rootCmd.SetErr(&buf)
	rootCmd.SetArgs([]string{
		"missions-retro", "getRetro",
		"--base-url", serverURL,
		"--missionId", missionId,
		"--json",
		"--no-color",
	})
	err := rootCmd.Execute()
	return buf.String(), err
}

// TestWriteRetroSendsReportInBody verifies that writeRetro POSTs the report
// to /api/missions/{id}/retro with retroReport in the request body.
func TestWriteRetroSendsReportInBody(t *testing.T) {
	const missionId = "M-20260329-test"
	const report = "## Sprint Retro\n\n### What went well\n- TDD kept quality high\n\n### What to improve\n- Faster feedback loops"

	var capturedPath string
	var capturedBody map[string]interface{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capturedPath = r.URL.Path
		capturedBody = captureBody(t, r)
		w.Header().Set("Content-Type", "application/json")
		w.Write(retroSuccessResponse(missionId))
	}))
	defer srv.Close()

	_, err := executeWriteRetro(t, srv.URL, missionId, report)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	expectedPath := "/api/missions/" + missionId + "/retro"
	if capturedPath != expectedPath {
		t.Errorf("expected POST to %q, got %q", expectedPath, capturedPath)
	}

	retroReport, ok := capturedBody["retroReport"]
	if !ok {
		t.Fatal("expected 'retroReport' field in request body, but it was missing")
	}
	if retroReport != report {
		t.Errorf("expected retroReport=%q, got %q", report, retroReport)
	}
}

// TestGetRetroReturnsReport verifies that getRetro GETs from /api/missions/{id}/retro
// and outputs the response.
func TestGetRetroReturnsReport(t *testing.T) {
	const missionId = "M-20260329-test"
	const report = "## Retro\n\nAll good."

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			t.Errorf("expected GET, got %s", r.Method)
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write(retroGetResponse(missionId, report))
	}))
	defer srv.Close()

	output, err := executeGetRetro(t, srv.URL, missionId)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if !strings.Contains(output, missionId) {
		t.Errorf("expected output to contain missionId %q, got: %s", missionId, output)
	}
}

// TestWriteRetroMissingMissionReturnsError verifies that a 404 from the API
// surfaces as an error to the caller.
func TestWriteRetroMissingMissionReturnsError(t *testing.T) {
	serverCalled := false
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		serverCalled = true
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotFound)
		resp := map[string]interface{}{
			"success": false,
			"error": map[string]interface{}{
				"code":    "MISSION_NOT_FOUND",
				"message": "Mission M-does-not-exist not found",
			},
		}
		b, _ := json.Marshal(resp)
		w.Write(b)
	}))
	defer srv.Close()

	output, err := executeWriteRetro(t, srv.URL, "M-does-not-exist", "some report")

	// The command must reach the server — if not, the implementation is missing
	if !serverCalled {
		t.Fatal("expected command to make an HTTP request to the API, but server was never called (missing implementation)")
	}

	combined := output
	if err != nil {
		combined += err.Error()
	}
	if !strings.Contains(combined, "not found") && !strings.Contains(combined, "MISSION_NOT_FOUND") {
		t.Errorf("expected error message mentioning missing mission, got: %s", combined)
	}
}

// TestWriteRetroHandlesLargeMarkdown verifies that multi-paragraph markdown
// content is sent without truncation or error.
func TestWriteRetroHandlesLargeMarkdown(t *testing.T) {
	const missionId = "M-20260329-large"
	largeReport := strings.Repeat("## Section\n\nLong paragraph content here.\n\n- Item one\n- Item two\n\n```go\nfunc main() {}\n```\n\n", 20)

	var capturedBody map[string]interface{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capturedBody = captureBody(t, r)
		w.Header().Set("Content-Type", "application/json")
		w.Write(retroSuccessResponse(missionId))
	}))
	defer srv.Close()

	_, err := executeWriteRetro(t, srv.URL, missionId, largeReport)
	if err != nil {
		t.Fatalf("unexpected error with large markdown: %v", err)
	}

	retroReport, ok := capturedBody["retroReport"]
	if !ok {
		t.Fatal("expected 'retroReport' in body for large markdown")
	}
	if retroReport != largeReport {
		t.Errorf("large markdown was not preserved in body (got length %d, expected %d)",
			len(retroReport.(string)), len(largeReport))
	}
}
