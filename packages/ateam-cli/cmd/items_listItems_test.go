package cmd

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
)

// listItemsSuccessResponse is a minimal valid listItems API response.
const listItemsSuccessResponse = `{"success":true,"data":[]}`

// executeListItems runs `items listItems` against a mock server with the
// given extra flags, returning the query params the CLI actually sent.
// Mirrors executeListActivity's flag-reset convention: cobra keeps flag
// values and Changed state across Execute calls in one process.
func executeListItems(t *testing.T, extraArgs ...string) url.Values {
	t.Helper()

	for _, name := range []string{"stage", "type", "priority", "agent", "missionId", "includeArchived"} {
		flag := itemsListItemsCmd.Flags().Lookup(name)
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
		if _, err := w.Write([]byte(listItemsSuccessResponse)); err != nil {
			t.Errorf("writing mock response: %v", err)
		}
	}))
	defer server.Close()

	var buf bytes.Buffer
	rootCmd.SetOut(&buf)
	rootCmd.SetErr(&buf)
	args := append([]string{
		"items", "listItems",
		"--base-url", server.URL,
		"--json",
		"--no-color",
	}, extraArgs...)
	rootCmd.SetArgs(args)
	if err := rootCmd.Execute(); err != nil {
		t.Fatalf("listItems failed: %v\noutput: %s", err, buf.String())
	}
	return capturedQuery
}

// PR #67 review: the retro agent derives learnings from a mission's completed
// finding-derived items. `ateam items listItems --json` returned every
// unarchived item in the PROJECT, so completed items from an earlier mission
// (left unarchived when an entry point created the next mission without
// --force) were derived under the current mission's id, inflating recurrence
// counts. GET /api/items already accepts missionId (openapi.yaml); the CLI
// simply never exposed it.
func TestListItemsSendsMissionIdFilter(t *testing.T) {
	query := executeListItems(t, "--missionId", "M-20260903-002")

	if got := query.Get("missionId"); got != "M-20260903-002" {
		t.Errorf("expected missionId=M-20260903-002, got missionId=%q", got)
	}
}

// An unset --missionId must not be sent at all — an empty `missionId=` would
// be read by the API as "items of the empty-string mission" (no rows), not
// as "no filter".
func TestListItemsOmitsMissionIdWhenFlagUnset(t *testing.T) {
	query := executeListItems(t)

	if query.Has("missionId") {
		t.Errorf("expected no missionId query param when --missionId is unset, got missionId=%q", query.Get("missionId"))
	}
}

// Retro re-runs happen after archival — the mission filter must compose with
// --includeArchived so an archived mission's items are still returned.
func TestListItemsMissionIdComposesWithIncludeArchived(t *testing.T) {
	query := executeListItems(t, "--missionId", "M-20260903-002", "--includeArchived")

	if got := query.Get("missionId"); got != "M-20260903-002" {
		t.Errorf("expected missionId=M-20260903-002, got missionId=%q", got)
	}
	if got := query.Get("includeArchived"); got != "true" {
		t.Errorf("expected includeArchived=true, got includeArchived=%q", got)
	}
}
