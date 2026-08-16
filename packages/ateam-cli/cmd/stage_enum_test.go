package cmd

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"os"
	"regexp"
	"strings"
	"testing"

	"github.com/spf13/pflag"
)

// Tests for WI-793: the Go CLI's client-side stage enums must include
// 'staged' (positioned between 'probing' and 'done') so --toStage staged /
// --stage staged reach the API instead of being rejected before the request
// is even sent. These enums are hand-maintained literals (no codegen in this
// repo — no Makefile, no go:generate, swagger-jack is not a dependency, per
// the item's context) duplicated across validate.Enum calls, flag help
// text, and shell-completion functions for board-move moveItem and items
// listItems. This file is the regression guard the item's own AC calls for:
// a Go test asserting the enum contains all 9 stages so it cannot silently
// drift from the spec again.

// wantStageOrder is the 9-stage source of truth this suite pins everything
// against: the same order WI-787 established in packages/shared/src/stages.ts.
var wantStageOrder = []string{
	"briefings", "ready", "testing", "implementing", "review", "probing", "staged", "done", "blocked",
}

// resetStageEnumFlagsForTest clears cobra's cached flag state between runs,
// mirroring resetTuningFlagsForTest's rationale in tuning_test.go: cobra
// caches flag values and Changed() status on the shared rootCmd, so
// successive invocations in the same test binary would otherwise see each
// other's state.
func resetStageEnumFlagsForTest() {
	rootCmd.PersistentFlags().VisitAll(func(f *pflag.Flag) {
		f.Changed = false
		_ = f.Value.Set(f.DefValue)
	})
	boardMoveMoveItemCmd.Flags().VisitAll(func(f *pflag.Flag) {
		f.Changed = false
		_ = f.Value.Set(f.DefValue)
	})
	itemsListItemsCmd.Flags().VisitAll(func(f *pflag.Flag) {
		f.Changed = false
		_ = f.Value.Set(f.DefValue)
	})
}

// runStageEnumCLI drives rootCmd with the given args plus --base-url
// pointing at the stub server, matching runTuning's convention in
// tuning_test.go.
func runStageEnumCLI(t *testing.T, serverURL string, args ...string) (string, error) {
	t.Helper()
	resetStageEnumFlagsForTest()
	var buf bytes.Buffer
	rootCmd.SetOut(&buf)
	rootCmd.SetErr(&buf)
	full := append([]string{}, args...)
	full = append(full, "--base-url", serverURL, "--no-color")
	rootCmd.SetArgs(full)
	err := rootCmd.Execute()
	return buf.String(), err
}

// AC1: `ateam board-move moveItem --toStage staged` is accepted by
// client-side validation and the request actually reaches the API — not
// just "no error", but the request body genuinely carries toStage=staged.
func TestBoardMoveToStage_AcceptsStaged(t *testing.T) {
	called := false
	var gotBody string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		buf := new(bytes.Buffer)
		_, _ = buf.ReadFrom(r.Body)
		gotBody = buf.String()
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"success":true,"data":{}}`))
	}))
	defer srv.Close()

	out, err := runStageEnumCLI(t, srv.URL, "board-move", "moveItem", "--itemId", "WI-001", "--toStage", "staged")
	if err != nil {
		t.Fatalf("expected --toStage staged to be accepted, got error: %v (output: %s)", err, out)
	}
	if !called {
		t.Fatalf("client-side validation rejected 'staged' before the request reached the API — output: %s", out)
	}
	if !strings.Contains(gotBody, `"toStage":"staged"`) {
		t.Errorf("request body does not carry toStage=staged: %s", gotBody)
	}
}

// Regression guard: an actually-invalid stage must still be rejected
// client-side (proves the fix didn't just disable validation entirely).
func TestBoardMoveToStage_StillRejectsInvalidStage(t *testing.T) {
	reached := false
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		reached = true
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	_, err := runStageEnumCLI(t, srv.URL, "board-move", "moveItem", "--itemId", "WI-001", "--toStage", "not-a-real-stage")
	if err == nil {
		t.Fatal("expected an error for an invalid --toStage value")
	}
	if !strings.Contains(err.Error(), "invalid value") {
		t.Errorf("expected an enum validation error, got: %v", err)
	}
	if reached {
		t.Error("an invalid --toStage value must not reach the API at all")
	}
}

// AC2: `ateam items listItems --stage staged` is accepted and the request
// reaches the API carrying stage=staged.
func TestItemsListItemsStage_AcceptsStaged(t *testing.T) {
	called := false
	var gotQuery string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		gotQuery = r.URL.RawQuery
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"success":true,"data":[]}`))
	}))
	defer srv.Close()

	out, err := runStageEnumCLI(t, srv.URL, "items", "listItems", "--stage", "staged")
	if err != nil {
		t.Fatalf("expected --stage staged to be accepted, got error: %v (output: %s)", err, out)
	}
	if !called {
		t.Fatalf("client-side validation rejected 'staged' before the request reached the API — output: %s", out)
	}
	if !strings.Contains(gotQuery, "stage=staged") {
		t.Errorf("request query does not carry stage=staged: %s", gotQuery)
	}
}

// AC3 (board-move moveItem): flag help text and shell completion both list
// staged between probing and done.
func TestBoardMoveToStageFlag_HelpAndCompletionIncludeStagedInOrder(t *testing.T) {
	flag := boardMoveMoveItemCmd.Flags().Lookup("toStage")
	if flag == nil {
		t.Fatal("--toStage flag not registered on board-move moveItem")
	}
	assertPipeListMatchesStageOrder(t, "board-move moveItem --toStage help", flag.Usage)

	completionFn, ok := boardMoveMoveItemCmd.GetFlagCompletionFunc("toStage")
	if !ok {
		t.Fatal("no shell-completion function registered for --toStage")
	}
	values, _ := completionFn(boardMoveMoveItemCmd, nil, "")
	assertStageOrder(t, "board-move moveItem --toStage completion", values)
}

// AC3 (items listItems): same, for --stage.
func TestItemsListItemsStageFlag_HelpAndCompletionIncludeStagedInOrder(t *testing.T) {
	flag := itemsListItemsCmd.Flags().Lookup("stage")
	if flag == nil {
		t.Fatal("--stage flag not registered on items listItems")
	}
	assertPipeListMatchesStageOrder(t, "items listItems --stage help", flag.Usage)

	completionFn, ok := itemsListItemsCmd.GetFlagCompletionFunc("stage")
	if !ok {
		t.Fatal("no shell-completion function registered for --stage")
	}
	values, _ := completionFn(itemsListItemsCmd, nil, "")
	assertStageOrder(t, "items listItems --stage completion", values)
}

// AC (explicit): "A Go test asserts the toStage enum contains all 9 stages,
// so the enum cannot silently drift from the spec again." The
// shell-completion function's returned list is the most directly
// introspectable representation of "the enum" available from outside the
// RunE closure — these enums are hand-maintained literal duplicates, not a
// shared named constant, so this is the regression guard the AC calls for.
func TestToStageEnum_ContainsAllNineStages(t *testing.T) {
	completionFn, ok := boardMoveMoveItemCmd.GetFlagCompletionFunc("toStage")
	if !ok {
		t.Fatal("no shell-completion function registered for --toStage")
	}
	values, _ := completionFn(boardMoveMoveItemCmd, nil, "")

	if len(values) != 9 {
		t.Fatalf("expected the toStage enum to contain 9 stages, got %d: %v", len(values), values)
	}
	assertStageOrder(t, "toStage enum", values)
}

// AC4: the StageId enum in packages/kanban-viewer/openapi.yaml stays in
// agreement with the CLI's own enum. Hand-parses the single spelled-out
// stage list (openapi.yaml explicitly has only one — see the item's
// context) rather than pulling in a YAML dependency for one line.
func TestOpenAPISpecStageIdEnum_MatchesCLIEnum(t *testing.T) {
	// Go test working directory is the package dir: packages/ateam-cli/cmd/.
	// Two levels up reaches packages/, then into kanban-viewer/.
	specPath := "../../kanban-viewer/openapi.yaml"
	data, err := os.ReadFile(specPath)
	if err != nil {
		t.Fatalf("could not read %s: %v", specPath, err)
	}

	re := regexp.MustCompile(`StageId:\s*\n\s*type:\s*string\s*\n\s*enum:\s*\[([^\]]+)\]`)
	match := re.FindStringSubmatch(string(data))
	if match == nil {
		t.Fatalf("could not find the StageId enum block in %s", specPath)
	}

	rawValues := strings.Split(match[1], ",")
	specStages := make([]string, len(rawValues))
	for i, v := range rawValues {
		specStages[i] = strings.TrimSpace(v)
	}

	assertStageOrder(t, "openapi.yaml StageId enum", specStages)
}

func assertPipeListMatchesStageOrder(t *testing.T, label, usage string) {
	t.Helper()
	trimmed := strings.Trim(usage, "()")
	assertStageOrder(t, label, strings.Split(trimmed, "|"))
}

func assertStageOrder(t *testing.T, label string, values []string) {
	t.Helper()
	if len(values) != len(wantStageOrder) {
		t.Errorf("%s: expected %d stages %v, got %d: %v", label, len(wantStageOrder), wantStageOrder, len(values), values)
		return
	}
	for i := range wantStageOrder {
		if values[i] != wantStageOrder[i] {
			t.Errorf("%s: expected stage order %v, got %v (first mismatch at index %d: want %q got %q)",
				label, wantStageOrder, values, i, wantStageOrder[i], values[i])
			return
		}
	}
}
