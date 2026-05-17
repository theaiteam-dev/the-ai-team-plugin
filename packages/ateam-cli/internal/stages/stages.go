// Package stages mirrors the stage transition rules and pipeline agent mapping
// defined in packages/shared/src/stages.ts.
//
// The contract test in stages_test.go loads packages/shared/fixtures/stage-matrix.json
// (exported by the shared-package build script) and verifies that ValidTransitions
// and PipelineStages match the TypeScript source exactly. Any drift between the
// two runtimes fails CI here, not at runtime.
package stages

// PipelineStageInfo describes a single pipeline stage: which agent is
// responsible, the display name used in messages, the expected next stage on
// the happy path, and a human-readable description.
//
// The field names and types are pinned by a compile-time contract in
// stages_test.go — rename or retype any field and the package will fail to
// build.
type PipelineStageInfo struct {
	Agent        string
	AgentDisplay string
	NextStage    string
	Description  string
}

// ValidTransitions is the Go mirror of TRANSITION_MATRIX from
// packages/shared/src/stages.ts. Each key is a stage ID; the slice contains
// every legal destination stage for that source stage.
//
// Target slices are treated as sets by the contract test — order does not
// matter, but membership must match exactly.
var ValidTransitions = map[string][]string{
	"briefings":    {"ready", "blocked"},
	"ready":        {"testing", "implementing", "probing", "blocked", "briefings"},
	"testing":      {"implementing", "blocked"},
	"implementing": {"review", "blocked"},
	"probing":      {"ready", "done", "blocked"},
	"review":       {"testing", "implementing", "probing", "blocked"},
	"done":         {},
	"blocked":      {"ready"},
}

// PipelineStages is the Go mirror of PIPELINE_STAGES from
// packages/shared/src/stages.ts. Only stages that have an assigned pipeline
// agent are included (briefings, ready, done, and blocked have no agent and
// are intentionally absent).
//
// All four fields (Agent, AgentDisplay, NextStage, Description) must match
// the TypeScript source character-for-character; the contract test checks each
// one independently and reports which field drifted.
var PipelineStages = map[string]PipelineStageInfo{
	"testing": {
		Agent:        "murdock",
		AgentDisplay: "Murdock",
		NextStage:    "implementing",
		Description:  "writes tests defining acceptance criteria",
	},
	"implementing": {
		Agent:        "ba",
		AgentDisplay: "B.A.",
		NextStage:    "review",
		Description:  "implements code to pass tests",
	},
	"review": {
		Agent:        "lynch",
		AgentDisplay: "Lynch",
		NextStage:    "probing",
		Description:  "reviews tests and implementation together",
	},
	"probing": {
		Agent:        "amy",
		AgentDisplay: "Amy",
		NextStage:    "done",
		Description:  "investigates for bugs beyond test coverage",
	},
}
