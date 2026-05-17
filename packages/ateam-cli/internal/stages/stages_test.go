// Package stages contract test.
//
// This file pins the Go side of the contract defined by
// packages/shared/src/stages.ts. The shared package's build script exports
// TRANSITION_MATRIX and PIPELINE_STAGES to a JSON fixture at:
//
//	packages/shared/fixtures/stage-matrix.json
//
// Expected fixture shape:
//
//	{
//	  "transitionMatrix": {
//	    "<stageId>": ["<targetStage>", ...],
//	    ...
//	  },
//	  "pipelineStages": {
//	    "<stageId>": {
//	      "agent":        "<agent>",
//	      "agentDisplay": "<AgentDisplay>",
//	      "nextStage":    "<nextStageId>",
//	      "description":  "<description>"
//	    },
//	    ...
//	  }
//	}
//
// The tests below load that fixture and verify the Go declarations in
// stages.go (ValidTransitions, PipelineStages, PipelineStageInfo) mirror it.
// Any drift between TypeScript and Go fails CI here, not at runtime.
package stages

import (
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"testing"
)

// fixturePipelineStageInfo mirrors the JSON shape exported from
// PIPELINE_STAGES in packages/shared/src/stages.ts.
type fixturePipelineStageInfo struct {
	Agent        string `json:"agent"`
	AgentDisplay string `json:"agentDisplay"`
	NextStage    string `json:"nextStage"`
	Description  string `json:"description"`
}

// stageMatrixFixture mirrors the top-level structure of stage-matrix.json.
type stageMatrixFixture struct {
	TransitionMatrix map[string][]string                 `json:"transitionMatrix"`
	PipelineStages   map[string]fixturePipelineStageInfo `json:"pipelineStages"`
}

// fixturePath resolves the absolute path to stage-matrix.json relative to
// THIS test file using runtime.Caller, so the test works regardless of the
// `go test` working directory.
//
// Layout assumption:
//
//	this file: packages/ateam-cli/internal/stages/stages_test.go
//	fixture:   packages/shared/fixtures/stage-matrix.json
//	relative:  ../../../shared/fixtures/stage-matrix.json
func fixturePath(t *testing.T) string {
	t.Helper()
	_, thisFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller(0) failed to locate stages_test.go")
	}
	return filepath.Join(
		filepath.Dir(thisFile),
		"..", "..", "..", "shared", "fixtures", "stage-matrix.json",
	)
}

// loadFixture reads and parses stage-matrix.json. Fails the test with a
// pointed message if the fixture is missing (build script never ran) or
// malformed (shape changed without updating this test).
func loadFixture(t *testing.T) stageMatrixFixture {
	t.Helper()
	path := fixturePath(t)
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("cannot read fixture %s: %v\n\n"+
			"The shared package build must write TRANSITION_MATRIX and PIPELINE_STAGES "+
			"to this path. Run `bun --cwd packages/shared run build` (or the equivalent "+
			"generate script) and retry.", path, err)
	}
	var fx stageMatrixFixture
	if err := json.Unmarshal(raw, &fx); err != nil {
		t.Fatalf("fixture %s is not valid JSON or has wrong shape: %v\n"+
			"Expected top-level keys: \"transitionMatrix\", \"pipelineStages\".", path, err)
	}
	return fx
}

// TestFixtureLoadsAndIsPopulated proves AC1: the shared-package build
// script wrote the fixture to the expected location and it contains both
// top-level sections.
//
// If this fails alone (other drift tests dependent on the fixture also
// fail), the build pipeline is broken — investigate the generate script
// before chasing field-level drift.
func TestFixtureLoadsAndIsPopulated(t *testing.T) {
	fx := loadFixture(t)
	if len(fx.TransitionMatrix) == 0 {
		t.Fatal("fixture.transitionMatrix is empty — build script likely broken or wrote wrong shape")
	}
	if len(fx.PipelineStages) == 0 {
		t.Fatal("fixture.pipelineStages is empty — build script likely broken or wrote wrong shape")
	}
}

// TestValidTransitionsCoversEveryFixtureStage proves AC2 + AC4 (missing
// direction): every stage in TS TRANSITION_MATRIX must appear in Go
// ValidTransitions with the same target set. Catches "TS added a stage and
// Go forgot to" and "TS changed a stage's targets and Go didn't follow".
//
// The test derives its stage list from the fixture (never hardcoded in Go),
// per the context note in WI-003.
func TestValidTransitionsCoversEveryFixtureStage(t *testing.T) {
	fx := loadFixture(t)
	for stage, wantTargets := range fx.TransitionMatrix {
		gotTargets, ok := ValidTransitions[stage]
		if !ok {
			t.Errorf("drift: stage %q is in TS TRANSITION_MATRIX but missing from Go ValidTransitions", stage)
			continue
		}
		if !sameSet(gotTargets, wantTargets) {
			t.Errorf("drift: stage %q transition targets differ\n"+
				"  TS  (fixture):  %v\n"+
				"  Go  (impl):     %v\n"+
				"  missing in Go:  %v\n"+
				"  extra in Go:    %v",
				stage,
				sortedCopy(wantTargets),
				sortedCopy(gotTargets),
				setDiff(wantTargets, gotTargets),
				setDiff(gotTargets, wantTargets),
			)
		}
	}
}

// TestValidTransitionsHasNoExtraStages proves AC4 (extra direction):
// every stage in Go ValidTransitions must appear in TS TRANSITION_MATRIX.
// Catches "Go declared a stage TS never knew about" — for example, an
// orphaned entry left over after a stage was removed from TS.
func TestValidTransitionsHasNoExtraStages(t *testing.T) {
	fx := loadFixture(t)
	for stage := range ValidTransitions {
		if _, ok := fx.TransitionMatrix[stage]; !ok {
			t.Errorf("drift: stage %q is in Go ValidTransitions but missing from TS TRANSITION_MATRIX (extra/stale entry)", stage)
		}
	}
}

// TestPipelineStagesCoversEveryFixtureStage proves AC3 + AC5 (missing
// direction): every stage in TS PIPELINE_STAGES must appear in Go
// PipelineStages and all four fields (Agent, AgentDisplay, NextStage,
// Description) must match exactly. Catches "TS added a pipeline stage and
// Go forgot to" and "TS changed agent/agentDisplay/nextStage/description
// and Go didn't follow".
func TestPipelineStagesCoversEveryFixtureStage(t *testing.T) {
	fx := loadFixture(t)
	for stage, want := range fx.PipelineStages {
		got, ok := PipelineStages[stage]
		if !ok {
			t.Errorf("drift: pipeline stage %q is in TS PIPELINE_STAGES but missing from Go PipelineStages", stage)
			continue
		}
		if got.Agent != want.Agent {
			t.Errorf("drift: pipeline stage %q .Agent\n  TS (fixture): %q\n  Go (impl):    %q",
				stage, want.Agent, got.Agent)
		}
		if got.AgentDisplay != want.AgentDisplay {
			t.Errorf("drift: pipeline stage %q .AgentDisplay\n  TS (fixture): %q\n  Go (impl):    %q",
				stage, want.AgentDisplay, got.AgentDisplay)
		}
		if got.NextStage != want.NextStage {
			t.Errorf("drift: pipeline stage %q .NextStage\n  TS (fixture): %q\n  Go (impl):    %q",
				stage, want.NextStage, got.NextStage)
		}
		if got.Description != want.Description {
			t.Errorf("drift: pipeline stage %q .Description\n  TS (fixture): %q\n  Go (impl):    %q",
				stage, want.Description, got.Description)
		}
	}
}

// TestPipelineStagesHasNoExtraStages proves AC5 (extra direction):
// every stage in Go PipelineStages must appear in TS PIPELINE_STAGES.
// Catches stale Go entries for pipeline stages removed from TS.
func TestPipelineStagesHasNoExtraStages(t *testing.T) {
	fx := loadFixture(t)
	for stage := range PipelineStages {
		if _, ok := fx.PipelineStages[stage]; !ok {
			t.Errorf("drift: pipeline stage %q is in Go PipelineStages but missing from TS PIPELINE_STAGES (extra/stale entry)", stage)
		}
	}
}

// pipelineStageInfoFieldContract pins AC3's struct declaration: the Go
// PipelineStageInfo type MUST have exactly these four exported fields with
// these exact names and string types. If a field is renamed (e.g.
// `Agent` → `AgentName`) or retyped, this package will FAIL TO COMPILE,
// surfacing the drift loudly at build time rather than at runtime.
//
// This is a compile-time contract; it intentionally has no runtime body.
var _ = PipelineStageInfo{
	Agent:        "",
	AgentDisplay: "",
	NextStage:    "",
	Description:  "",
}

// sameSet reports whether a and b contain the same elements regardless of
// order. Transition target arrays are conceptually sets, not ordered lists.
func sameSet(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	sa, sb := sortedCopy(a), sortedCopy(b)
	for i := range sa {
		if sa[i] != sb[i] {
			return false
		}
	}
	return true
}

// sortedCopy returns a sorted copy of in, leaving the original untouched.
func sortedCopy(in []string) []string {
	out := append([]string(nil), in...)
	sort.Strings(out)
	return out
}

// setDiff returns elements present in `a` but not in `b`, sorted.
func setDiff(a, b []string) []string {
	set := make(map[string]struct{}, len(b))
	for _, s := range b {
		set[s] = struct{}{}
	}
	var out []string
	for _, s := range a {
		if _, ok := set[s]; !ok {
			out = append(out, s)
		}
	}
	sort.Strings(out)
	return out
}
