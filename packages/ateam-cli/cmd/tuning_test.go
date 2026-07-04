package cmd

import (
	"bytes"
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
		if r.Method == http.MethodPost || r.Method == http.MethodPatch {
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
	for _, name := range []string{"candidates", "propose", "apply"} {
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

// TestTuningProposePerformsPost verifies `tuning propose` POSTs the target
// surface and altitude to /api/tuning/proposals.
func TestTuningProposePerformsPost(t *testing.T) {
	srv, cap := newTuningTestServer(t, `{"id":42,"linkedLearningIds":[1,2]}`)
	defer srv.Close()

	_, err := runTuning(t, srv.URL, "tuning", "propose",
		"--target-surface", "skill:defensive-coding",
		"--altitude", "skill-text")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cap.method != http.MethodPost {
		t.Errorf("expected POST, got %s", cap.method)
	}
	if cap.path != "/api/tuning/proposals" {
		t.Errorf("expected path /api/tuning/proposals, got %s", cap.path)
	}
	if cap.body["targetSurface"] != "skill:defensive-coding" {
		t.Errorf("expected targetSurface in body, got %v", cap.body["targetSurface"])
	}
	if cap.body["altitude"] != "skill-text" {
		t.Errorf("expected altitude in body, got %v", cap.body["altitude"])
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
	for _, k := range []string{"proposalText", "dismissalNote", "altitude", "mergeIntoFingerprint"} {
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
			name:        "reject forwards dismissal-note",
			args:        []string{"tuning", "apply", "--id", "7", "--verb", "reject", "--dismissal-note", "taste, not a defect"},
			wantPresent: map[string]string{"verb": "reject", "dismissalNote": "taste, not a defect"},
			wantAbsent:  []string{"proposalText", "altitude", "mergeIntoFingerprint"},
		},
		{
			name:        "edit forwards proposal-text",
			args:        []string{"tuning", "apply", "--id", "5", "--verb", "edit", "--proposal-text", "amended text"},
			wantPresent: map[string]string{"verb": "edit", "proposalText": "amended text"},
			wantAbsent:  []string{"dismissalNote", "altitude", "mergeIntoFingerprint"},
		},
		{
			name:        "merge forwards merge-into as mergeIntoFingerprint",
			args:        []string{"tuning", "apply", "--id", "3", "--verb", "merge", "--merge-into", "fp-target"},
			wantPresent: map[string]string{"verb": "merge", "mergeIntoFingerprint": "fp-target"},
			wantAbsent:  []string{"proposalText", "dismissalNote", "altitude"},
		},
		{
			name:        "demote forwards dismissal-note and altitude",
			args:        []string{"tuning", "apply", "--id", "9", "--verb", "demote", "--dismissal-note", "wrong altitude", "--altitude", "agent-prompt"},
			wantPresent: map[string]string{"verb": "demote", "dismissalNote": "wrong altitude", "altitude": "agent-prompt"},
			wantAbsent:  []string{"proposalText", "mergeIntoFingerprint"},
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
