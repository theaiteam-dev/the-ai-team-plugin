package cmd

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/spf13/cobra"
	"github.com/spf13/pflag"
)

// Smoke tests for the `ateam tuning` command group (WI-216): the candidates,
// propose, and apply subcommands are thin cobra wrappers over the tuning API
// (mirroring `ateam learnings rank` / `learnings create`). These tests assert
// each subcommand is registered under the `tuning` parent and issues the
// expected HTTP method + path (and forwards the right body) against a stubbed
// httptest server — the same convention as missions-final-review_test.go.

// tuningCapture records what the stubbed API server received.
type tuningCapture struct {
	called bool
	method string
	path   string
	body   map[string]interface{}
}

// newTuningTestServer returns a stub API server that records the request and
// replies with respBody (HTTP 200 so the client does not treat it as an error).
func newTuningTestServer(t *testing.T, respBody string) (*httptest.Server, *tuningCapture) {
	t.Helper()
	cap := &tuningCapture{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		cap.called = true
		cap.method = r.Method
		cap.path = r.URL.Path
		// `tuning defer` POSTs with no body at all (unlike propose/apply) — only
		// attempt to parse a body when the client actually sent one, or
		// captureBody's json.Unmarshal("") fails the test with a false-negative
		// "parsing request body" error.
		if (r.Method == http.MethodPost || r.Method == http.MethodPatch) && r.ContentLength != 0 {
			cap.body = captureBody(t, r)
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(respBody))
	}))
	return srv, cap
}

// findTuningSubcommand returns the child of parent whose name matches, or nil.
func findTuningSubcommand(parent *cobra.Command, name string) *cobra.Command {
	for _, c := range parent.Commands() {
		if c.Name() == name {
			return c
		}
	}
	return nil
}

// resetTuningFlagsForTest clears cobra's cached flag state between runs. Cobra
// caches flag values and Changed() status on the shared rootCmd, so successive
// invocations of the same subcommand with different flags would otherwise see
// each other's state. This only touches command/flag names (the CLI contract),
// never the implementation's module-level variables.
func resetTuningFlagsForTest() {
	rootCmd.PersistentFlags().VisitAll(func(f *pflag.Flag) {
		f.Changed = false
		_ = f.Value.Set(f.DefValue)
	})
	tuning := findTuningSubcommand(rootCmd, "tuning")
	if tuning == nil {
		return
	}
	for _, sub := range tuning.Commands() {
		sub.Flags().VisitAll(func(f *pflag.Flag) {
			f.Changed = false
			_ = f.Value.Set(f.DefValue)
		})
	}
	// pflag's stringArrayValue tracks its own private "changed" bit and
	// APPENDS on every Set() once it has been set once — it never goes back
	// to "replace" mode. The generic f.Value.Set(f.DefValue) reset above
	// therefore appends the default marker onto --fingerprint instead of
	// clearing it, leaking values between tests. Reset the backing package
	// variable directly (same underlying memory the Value points at).
	tuningProposeCmdFingerprint = nil
}

// runTuning drives rootCmd with the given args plus --base-url pointing at the
// stub server, and returns captured stdout/stderr and the execution error.
func runTuning(t *testing.T, serverURL string, args ...string) (string, error) {
	t.Helper()
	resetTuningFlagsForTest()
	var buf bytes.Buffer
	rootCmd.SetOut(&buf)
	rootCmd.SetErr(&buf)
	full := append([]string{}, args...)
	full = append(full, "--base-url", serverURL, "--no-color")
	rootCmd.SetArgs(full)
	err := rootCmd.Execute()
	return buf.String(), err
}

// TestTuningParentRegistersSubcommands verifies the command tree: a `tuning`
// parent under root, with candidates/propose/apply children.
func TestTuningParentRegistersSubcommands(t *testing.T) {
	tuning := findTuningSubcommand(rootCmd, "tuning")
	if tuning == nil {
		t.Fatal("expected a `tuning` command registered under root")
	}
	for _, name := range []string{"candidates", "propose", "apply", "defer"} {
		if findTuningSubcommand(tuning, name) == nil {
			t.Errorf("expected `tuning %s` subcommand to be registered", name)
		}
	}
}

// TestTuningCandidatesJSONPerformsGet verifies `tuning candidates --json` issues
// GET /api/tuning/candidates and prints the JSON response.
func TestTuningCandidatesJSONPerformsGet(t *testing.T) {
	srv, cap := newTuningTestServer(t, `[{"fingerprint":"fp-defensive","hits":9,"resurfaced":false}]`)
	defer srv.Close()

	out, err := runTuning(t, srv.URL, "tuning", "candidates", "--json")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !cap.called {
		t.Fatal("expected the command to call the API, but the server was never hit")
	}
	if cap.method != http.MethodGet {
		t.Errorf("expected GET, got %s", cap.method)
	}
	if cap.path != "/api/tuning/candidates" {
		t.Errorf("expected path /api/tuning/candidates, got %s", cap.path)
	}
	if !strings.Contains(out, "fp-defensive") {
		t.Errorf("expected --json output to contain the response, got: %s", out)
	}
}

// TestTuningCandidatesTableModePerformsGet verifies the non-json path still
// issues the GET and renders without error (table output goes to os.Stdout).
func TestTuningCandidatesTableModePerformsGet(t *testing.T) {
	srv, cap := newTuningTestServer(t, `[{"fingerprint":"fp-defensive","hits":9,"resurfaced":false}]`)
	defer srv.Close()

	_, err := runTuning(t, srv.URL, "tuning", "candidates")
	if err != nil {
		t.Fatalf("unexpected error in table mode: %v", err)
	}
	if !cap.called {
		t.Fatal("expected the command to call the API, but the server was never hit")
	}
	if cap.method != http.MethodGet || cap.path != "/api/tuning/candidates" {
		t.Errorf("expected GET /api/tuning/candidates, got %s %s", cap.method, cap.path)
	}
}

// TestTuningCandidatesActionableFlagAddsQueryParam verifies `--actionable`
// maps to GET /api/tuning/candidates?actionable=true.
func TestTuningCandidatesActionableFlagAddsQueryParam(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.RawQuery != "actionable=true" {
			t.Errorf("expected query actionable=true, got %q", r.URL.RawQuery)
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`[{"fingerprint":"fp-defensive","corroborated":true,"distinctMissions":3}]`))
	}))
	defer srv.Close()

	out, err := runTuning(t, srv.URL, "tuning", "candidates", "--actionable", "--json")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !strings.Contains(out, "corroborated") {
		t.Errorf("expected output to contain corroborated field, got: %s", out)
	}
}

// TestTuningCandidatesWithoutActionableFlagOmitsQueryParam verifies the
// default (no --actionable) issues a bare GET with no query string.
func TestTuningCandidatesWithoutActionableFlagOmitsQueryParam(t *testing.T) {
	srv, cap := newTuningTestServer(t, `[]`)
	defer srv.Close()

	_, err := runTuning(t, srv.URL, "tuning", "candidates", "--json")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cap.path != "/api/tuning/candidates" {
		t.Errorf("expected path /api/tuning/candidates, got %s", cap.path)
	}
}

// TestTuningApplyForwardsTargetSurface verifies --target-surface (used by
// edit/demote to re-target the agreed surface) is forwarded as targetSurface
// only when explicitly set.
func TestTuningApplyForwardsTargetSurface(t *testing.T) {
	srv, cap := newTuningTestServer(t, `{"id":1,"status":"accepted"}`)
	defer srv.Close()

	_, err := runTuning(t, srv.URL, "tuning", "apply", "--id", "1", "--verb", "edit", "--target-surface", "agents/ba.md")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cap.body["targetSurface"] != "agents/ba.md" {
		t.Errorf("expected targetSurface in body, got %v", cap.body["targetSurface"])
	}
}

// TestTuningApplyMergeSurfacesSameMissionMergeError verifies a 422
// SAME_MISSION_MERGE response is surfaced as a clear, untruncated error
// rather than a generic "unexpected status" dump of the raw JSON body.
func TestTuningApplyMergeSurfacesSameMissionMergeError(t *testing.T) {
	longMessage := "Cannot merge: fingerprint(s) [fp-source-one, fp-source-two] share a mission with " +
		"\"fp-target\" — they are distinct facets of one mission's evidence, not independent corroboration, " +
		"and merging them can never legitimately reach the distinct-mission threshold."
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnprocessableEntity)
		body, _ := json.Marshal(map[string]interface{}{
			"success": false,
			"error": map[string]string{
				"code":    "SAME_MISSION_MERGE",
				"message": longMessage,
			},
		})
		w.Write(body)
	}))
	defer srv.Close()

	_, err := runTuning(t, srv.URL, "tuning", "apply", "--id", "3", "--verb", "merge", "--merge-into", "fp-target")
	if err == nil {
		t.Fatal("expected an error for a 422 SAME_MISSION_MERGE response")
	}
	if !strings.Contains(err.Error(), "SAME_MISSION_MERGE") {
		t.Errorf("expected error to contain the SAME_MISSION_MERGE code, got: %v", err)
	}
	if !strings.Contains(err.Error(), longMessage) {
		t.Errorf("expected error to contain the full untruncated message, got: %v", err)
	}
}

// TestTuningProposePerformsPost verifies `tuning propose` POSTs the agreed
// fingerprints/targetSurface/altitude/proposalText to /api/tuning/proposals
// (Phase A: propose IS the post-agreement creation, not a browsing draft).
func TestTuningProposePerformsPost(t *testing.T) {
	srv, cap := newTuningTestServer(t, `{"id":42,"status":"accepted","fingerprints":["fp-defensive"]}`)
	defer srv.Close()

	_, err := runTuning(t, srv.URL, "tuning", "propose",
		"--fingerprint", "fp-defensive",
		"--target-surface", "skill:defensive-coding",
		"--altitude", "skill-text",
		"--proposal-text", "Add a guard clause before the write.")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cap.method != http.MethodPost {
		t.Errorf("expected POST, got %s", cap.method)
	}
	if cap.path != "/api/tuning/proposals" {
		t.Errorf("expected path /api/tuning/proposals, got %s", cap.path)
	}
	fingerprints, ok := cap.body["fingerprints"].([]interface{})
	if !ok || len(fingerprints) != 1 || fingerprints[0] != "fp-defensive" {
		t.Errorf("expected fingerprints:[\"fp-defensive\"] in body, got %v", cap.body["fingerprints"])
	}
	if cap.body["targetSurface"] != "skill:defensive-coding" {
		t.Errorf("expected targetSurface in body, got %v", cap.body["targetSurface"])
	}
	if cap.body["altitude"] != "skill-text" {
		t.Errorf("expected altitude in body, got %v", cap.body["altitude"])
	}
	if cap.body["proposalText"] != "Add a guard clause before the write." {
		t.Errorf("expected proposalText in body, got %v", cap.body["proposalText"])
	}
}

// TestTuningProposeSupportsMultipleFingerprints verifies --fingerprint is
// repeatable, forwarding every value as one fingerprints[] array.
func TestTuningProposeSupportsMultipleFingerprints(t *testing.T) {
	srv, cap := newTuningTestServer(t, `{"id":43,"status":"accepted"}`)
	defer srv.Close()

	_, err := runTuning(t, srv.URL, "tuning", "propose",
		"--fingerprint", "fp-a",
		"--fingerprint", "fp-b",
		"--target-surface", "skill:defensive-coding",
		"--altitude", "skill-text",
		"--proposal-text", "text")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	fingerprints, ok := cap.body["fingerprints"].([]interface{})
	if !ok || len(fingerprints) != 2 || fingerprints[0] != "fp-a" || fingerprints[1] != "fp-b" {
		t.Errorf("expected fingerprints:[\"fp-a\",\"fp-b\"] in body, got %v", cap.body["fingerprints"])
	}
}

// TestTuningProposeRequiresAllFlags verifies the client fails fast (without
// hitting the API) when a required flag is missing.
func TestTuningProposeRequiresAllFlags(t *testing.T) {
	srv, cap := newTuningTestServer(t, `{}`)
	defer srv.Close()

	_, err := runTuning(t, srv.URL, "tuning", "propose",
		"--target-surface", "skill:defensive-coding",
		"--altitude", "skill-text",
		"--proposal-text", "text")
	if err == nil {
		t.Fatal("expected an error when --fingerprint is not set")
	}
	if cap.called {
		t.Error("expected the API to NOT be called when a required flag is missing")
	}
}

// TestTuningApplyPerformsPatchWithVerb verifies `tuning apply --id 12 --verb
// accept` PATCHes /api/tuning/proposals/12 with only the verb in the body —
// verb-specific flags that were not set must NOT be forwarded.
func TestTuningApplyPerformsPatchWithVerb(t *testing.T) {
	srv, cap := newTuningTestServer(t, `{"id":12,"status":"accepted"}`)
	defer srv.Close()

	_, err := runTuning(t, srv.URL, "tuning", "apply", "--id", "12", "--verb", "accept")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cap.method != http.MethodPatch {
		t.Errorf("expected PATCH, got %s", cap.method)
	}
	if cap.path != "/api/tuning/proposals/12" {
		t.Errorf("expected path /api/tuning/proposals/12, got %s", cap.path)
	}
	if cap.body["verb"] != "accept" {
		t.Errorf("expected verb=accept in body, got %v", cap.body["verb"])
	}
	// Unset verb-specific flags must be absent (guarded by cmd.Flags().Changed).
	for _, k := range []string{"proposalText", "altitude", "mergeIntoFingerprint"} {
		if _, present := cap.body[k]; present {
			t.Errorf("did not expect unset flag %q to be forwarded in body: %v", k, cap.body)
		}
	}
}

// TestTuningApplyForwardsVerbFlagsOnlyWhenSet verifies each verb-specific flag
// is forwarded under its API body key when set, and absent when not.
func TestTuningApplyForwardsVerbFlagsOnlyWhenSet(t *testing.T) {
	cases := []struct {
		name        string
		args        []string
		wantPresent map[string]string
		wantAbsent  []string
	}{
		{
			name:        "edit forwards proposal-text",
			args:        []string{"tuning", "apply", "--id", "5", "--verb", "edit", "--proposal-text", "amended text"},
			wantPresent: map[string]string{"verb": "edit", "proposalText": "amended text"},
			wantAbsent:  []string{"altitude", "mergeIntoFingerprint"},
		},
		{
			name:        "edit forwards altitude and target-surface for re-targeting",
			args:        []string{"tuning", "apply", "--id", "6", "--verb", "edit", "--altitude", "agent-prompt", "--target-surface", "agents/ba.md"},
			wantPresent: map[string]string{"verb": "edit", "altitude": "agent-prompt", "targetSurface": "agents/ba.md"},
			wantAbsent:  []string{"proposalText", "mergeIntoFingerprint"},
		},
		{
			name:        "merge forwards merge-into as mergeIntoFingerprint",
			args:        []string{"tuning", "apply", "--id", "3", "--verb", "merge", "--merge-into", "fp-target"},
			wantPresent: map[string]string{"verb": "merge", "mergeIntoFingerprint": "fp-target"},
			wantAbsent:  []string{"proposalText", "altitude"},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			srv, cap := newTuningTestServer(t, `{"id":1,"status":"draft"}`)
			defer srv.Close()

			_, err := runTuning(t, srv.URL, tc.args...)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if cap.method != http.MethodPatch {
				t.Errorf("expected PATCH, got %s", cap.method)
			}
			for k, want := range tc.wantPresent {
				if got := cap.body[k]; got != want {
					t.Errorf("expected body[%q]=%q, got %v", k, want, got)
				}
			}
			for _, k := range tc.wantAbsent {
				if _, present := cap.body[k]; present {
					t.Errorf("did not expect unset flag %q to be forwarded: %v", k, cap.body)
				}
			}
		})
	}
}

// TestTuningDeferPerformsPostToFingerprintEndpoint verifies `tuning defer
// --fingerprint <slug>` POSTs to /api/tuning/fingerprints/{slug}/defer with no
// body — defer is fingerprint-scoped (collapsed verb set: reject/demote are
// gone, folded into this durable watermark), unlike the removed reject/demote
// verbs which operated on an existing proposal id via `tuning apply`.
func TestTuningDeferPerformsPostToFingerprintEndpoint(t *testing.T) {
	srv, cap := newTuningTestServer(t, `{"slug":"fp-defensive","deferredAtMissions":3,"distinctMissions":3}`)
	defer srv.Close()

	out, err := runTuning(t, srv.URL, "tuning", "defer", "--fingerprint", "fp-defensive", "--json")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !cap.called {
		t.Fatal("expected the command to call the API, but the server was never hit")
	}
	if cap.method != http.MethodPost {
		t.Errorf("expected POST, got %s", cap.method)
	}
	if cap.path != "/api/tuning/fingerprints/fp-defensive/defer" {
		t.Errorf("expected path /api/tuning/fingerprints/fp-defensive/defer, got %s", cap.path)
	}
	if !strings.Contains(out, "deferredAtMissions") {
		t.Errorf("expected --json output to contain the response, got: %s", out)
	}
}

// TestTuningDeferRequiresFingerprintFlag verifies the client fails fast
// (without hitting the API) when --fingerprint is not set.
func TestTuningDeferRequiresFingerprintFlag(t *testing.T) {
	srv, cap := newTuningTestServer(t, `{}`)
	defer srv.Close()

	_, err := runTuning(t, srv.URL, "tuning", "defer")
	if err == nil {
		t.Fatal("expected an error when --fingerprint is not set")
	}
	if cap.called {
		t.Error("expected the API to NOT be called when a required flag is missing")
	}
}
