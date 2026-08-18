package cmd

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
)

// listActivitySuccessResponse is a minimal valid listActivity API response.
const listActivitySuccessResponse = `{"success":true,"data":{"entries":[]}}`

// executeListActivity runs `activity listActivity` against the mock server with
// the given extra flags, returning the query params the CLI actually sent.
func executeListActivity(t *testing.T, extraArgs ...string) url.Values {
	t.Helper()

	// Cobra keeps flag values and Changed state across Execute calls in the
	// same process — reset so each test observes only its own flags.
	for _, name := range []string{"limit", "missionId"} {
		flag := activityListActivityCmd.Flags().Lookup(name)
		if flag == nil {
			t.Fatalf("flag %q not registered", name)
		}
		if err := flag.Value.Set(flag.DefValue); err != nil {
			t.Fatalf("resetting flag %q: %v", name, err)
		}
		flag.Changed = false
	}

	var capturedQuery url.Values
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capturedQuery = r.URL.Query()
		w.Header().Set("Content-Type", "application/json")
		if _, err := w.Write([]byte(listActivitySuccessResponse)); err != nil {
			t.Errorf("writing mock response: %v", err)
		}
	}))
	defer server.Close()

	var buf bytes.Buffer
	rootCmd.SetOut(&buf)
	rootCmd.SetErr(&buf)
	args := append([]string{
		"activity", "listActivity",
		"--base-url", server.URL,
		"--json",
		"--no-color",
	}, extraArgs...)
	rootCmd.SetArgs(args)
	if err := rootCmd.Execute(); err != nil {
		t.Fatalf("listActivity failed: %v\noutput: %s", err, buf.String())
	}
	return capturedQuery
}

// Regression (M-20260812-001 retro): the unset int flag's zero-value was sent
// as a literal limit=0, which the API honored, silently returning an empty
// feed indistinguishable from "no data exists".
func TestListActivityOmitsLimitWhenFlagUnset(t *testing.T) {
	query := executeListActivity(t)

	if query.Has("limit") {
		t.Errorf("expected no limit query param when --limit is unset, got limit=%q", query.Get("limit"))
	}
}

func TestListActivitySendsExplicitLimit(t *testing.T) {
	query := executeListActivity(t, "--limit", "50")

	if got := query.Get("limit"); got != "50" {
		t.Errorf("expected limit=50, got limit=%q", got)
	}
}

func TestListActivitySendsMissionIdFilter(t *testing.T) {
	query := executeListActivity(t, "--missionId", "M-20260812-001")

	if got := query.Get("missionId"); got != "M-20260812-001" {
		t.Errorf("expected missionId=M-20260812-001, got missionId=%q", got)
	}
}
