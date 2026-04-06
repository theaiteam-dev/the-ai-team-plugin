package cmd

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// finalReviewSuccessResponse returns a minimal valid writeFinalReview API response.
func finalReviewSuccessResponse(missionId string) []byte {
	resp := map[string]interface{}{
		"success": true,
		"data": map[string]interface{}{
			"missionId": missionId,
		},
	}
	b, _ := json.Marshal(resp)
	return b
}

// finalReviewGetResponse returns a getFinalReview API response with the given report.
func finalReviewGetResponse(missionId, report string) []byte {
	resp := map[string]interface{}{
		"success": true,
		"data": map[string]interface{}{
			"missionId":   missionId,
			"finalReview": report,
		},
	}
	b, _ := json.Marshal(resp)
	return b
}

// executeWriteFinalReview runs the writeFinalReview command against the mock server.
func executeWriteFinalReview(t *testing.T, serverURL, missionId, report string) (string, error) {
	t.Helper()
	var buf bytes.Buffer
	rootCmd.SetOut(&buf)
	rootCmd.SetErr(&buf)
	rootCmd.SetArgs([]string{
		"missions-final-review", "writeFinalReview",
		"--base-url", serverURL,
		"--missionId", missionId,
		"--report", report,
		"--no-color",
	})
	err := rootCmd.Execute()
	return buf.String(), err
}

// executeGetFinalReview runs the getFinalReview command against the mock server.
func executeGetFinalReview(t *testing.T, serverURL, missionId string) (string, error) {
	t.Helper()
	var buf bytes.Buffer
	rootCmd.SetOut(&buf)
	rootCmd.SetErr(&buf)
	rootCmd.SetArgs([]string{
		"missions-final-review", "getFinalReview",
		"--base-url", serverURL,
		"--missionId", missionId,
		"--json",
		"--no-color",
	})
	err := rootCmd.Execute()
	return buf.String(), err
}

// TestWriteFinalReviewSendsReportInBody verifies that writeFinalReview POSTs the report
// to /api/missions/{id}/final-review with finalReview in the request body.
func TestWriteFinalReviewSendsReportInBody(t *testing.T) {
	const missionId = "M-20260406-test"
	const report = "## Final Review\n\n### Verdict: APPROVED\n\n- All PRD requirements met\n- 12 tests passing\n- No security issues"

	var capturedPath string
	var capturedBody map[string]interface{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capturedPath = r.URL.Path
		capturedBody = captureBody(t, r)
		w.Header().Set("Content-Type", "application/json")
		w.Write(finalReviewSuccessResponse(missionId))
	}))
	defer srv.Close()

	_, err := executeWriteFinalReview(t, srv.URL, missionId, report)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	expectedPath := "/api/missions/" + missionId + "/final-review"
	if capturedPath != expectedPath {
		t.Errorf("expected POST to %q, got %q", expectedPath, capturedPath)
	}

	finalReview, ok := capturedBody["finalReview"]
	if !ok {
		t.Fatal("expected 'finalReview' field in request body, but it was missing")
	}
	if finalReview != report {
		t.Errorf("expected finalReview=%q, got %q", report, finalReview)
	}
}

// TestGetFinalReviewReturnsReport verifies that getFinalReview GETs from /api/missions/{id}/final-review
// and outputs the response.
func TestGetFinalReviewReturnsReport(t *testing.T) {
	const missionId = "M-20260406-test"
	const report = "## Final Review\n\nFINAL APPROVED."

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			t.Errorf("expected GET, got %s", r.Method)
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write(finalReviewGetResponse(missionId, report))
	}))
	defer srv.Close()

	output, err := executeGetFinalReview(t, srv.URL, missionId)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if !strings.Contains(output, missionId) {
		t.Errorf("expected output to contain missionId %q, got: %s", missionId, output)
	}
}

// TestWriteFinalReviewMissingMissionReturnsError verifies that a 404 from the API
// surfaces as an error to the caller.
func TestWriteFinalReviewMissingMissionReturnsError(t *testing.T) {
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

	output, err := executeWriteFinalReview(t, srv.URL, "M-does-not-exist", "some report")

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

// TestWriteFinalReviewHandlesLargeMarkdown verifies that multi-paragraph markdown
// content is sent without truncation or error.
func TestWriteFinalReviewHandlesLargeMarkdown(t *testing.T) {
	const missionId = "M-20260406-large"
	largeReport := strings.Repeat("## Section\n\nLong paragraph content here.\n\n- Item one\n- Item two\n\n```go\nfunc main() {}\n```\n\n", 20)

	var capturedBody map[string]interface{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capturedBody = captureBody(t, r)
		w.Header().Set("Content-Type", "application/json")
		w.Write(finalReviewSuccessResponse(missionId))
	}))
	defer srv.Close()

	_, err := executeWriteFinalReview(t, srv.URL, missionId, largeReport)
	if err != nil {
		t.Fatalf("unexpected error with large markdown: %v", err)
	}

	finalReview, ok := capturedBody["finalReview"]
	if !ok {
		t.Fatal("expected 'finalReview' in body for large markdown")
	}
	if finalReview != largeReport {
		t.Errorf("large markdown was not preserved in body (got length %d, expected %d)",
			len(finalReview.(string)), len(largeReport))
	}
}
