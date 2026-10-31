package itemcommit

import (
	"reflect"
	"testing"
)

// Contract the implementation (attribution.go) must satisfy:
//
//	type Item struct {
//		ID      string
//		Stage   string   // "testing", "implementing", "staged", "done", "archived", ...
//		Outputs []string // outputs.test / outputs.impl / outputs.types; empty strings = unset
//	}
//	type Input struct {
//		Changed  []string // paths changed in the working tree
//		Self     Item     // the item being committed
//		Others   []Item   // every other item in the mission
//		Baseline []string // paths listed in the baseline-dirty file
//	}
//	type Result struct {
//		Paths           []string // to commit, sorted, de-duplicated
//		Undeclared      []string // subset of Paths no mission item declares, sorted
//		ChangedBaseline []string // baseline paths that changed, never in Paths, sorted
//	}
//	func Attribute(in Input) Result
//	func ParsePorcelain(out []byte) []string // `git status --porcelain=v1 -z --untracked-files=all`

func attrSelf() Item {
	return Item{ID: "WI-1", Stage: "review", Outputs: []string{"src/a.test.ts", "src/a.ts", ""}}
}

func TestAttribute_MixedPaths(t *testing.T) {
	got := Attribute(Input{
		Changed: []string{"src/a.ts", "src/a.test.ts", "src/b.ts", "src/c.ts"},
		Self:    attrSelf(),
		Others: []Item{
			{ID: "WI-2", Stage: "implementing", Outputs: []string{"src/b.ts"}},
			{ID: "WI-3", Stage: "staged", Outputs: []string{"src/c.ts"}},
		},
	})
	want := Result{
		Paths:      []string{"src/a.test.ts", "src/a.ts", "src/c.ts"},
		Undeclared: []string{"src/c.ts"},
	}
	attrAssertResult(t, got, want)
}

func TestAttribute_UndeclaredPathIncluded(t *testing.T) {
	got := Attribute(Input{
		Changed: []string{"src/a.ts", "src/routes/index.ts"},
		Self:    attrSelf(),
	})
	attrAssertResult(t, got, Result{
		Paths:      []string{"src/a.ts", "src/routes/index.ts"},
		Undeclared: []string{"src/routes/index.ts"},
	})
}

func TestAttribute_BaselineNeverIncluded(t *testing.T) {
	// Covers declared-by-self, declared-by-nobody, and declared-by-staged-other:
	// baseline wins in every case.
	got := Attribute(Input{
		Changed:  []string{"src/a.ts", "notes.md", "src/c.ts", "src/d.ts"},
		Self:     attrSelf(),
		Others:   []Item{{ID: "WI-3", Stage: "staged", Outputs: []string{"src/c.ts"}}},
		Baseline: []string{"src/a.ts", "notes.md", "src/c.ts", "untouched.md"},
	})
	attrAssertResult(t, got, Result{
		Paths:           []string{"src/d.ts"},
		Undeclared:      []string{"src/d.ts"},
		ChangedBaseline: []string{"notes.md", "src/a.ts", "src/c.ts"},
	})
}

func TestAttribute_NothingToCommitIsEmpty(t *testing.T) {
	got := Attribute(Input{
		Changed: []string{"src/b.ts"},
		Self:    attrSelf(),
		Others:  []Item{{ID: "WI-2", Stage: "testing", Outputs: []string{"src/b.ts"}}},
	})
	attrAssertResult(t, got, Result{})
	if len(got.Paths) != 0 {
		t.Fatalf("caller skips the commit on empty Paths, got %v", got.Paths)
	}
}

func TestAttribute_NoChangesAtAll(t *testing.T) {
	attrAssertResult(t, Attribute(Input{Self: attrSelf()}), Result{})
}

func TestAttribute_EvidenceAndSpecsNeverUndeclared(t *testing.T) {
	got := Attribute(Input{
		Changed: []string{
			".qa-evidence/M-1/checklist.md",
			"specs/flows/login.yaml",
			"src/a.ts",
		},
		Self: attrSelf(),
	})
	attrAssertResult(t, got, Result{Paths: []string{"src/a.ts"}})
}

func TestAttribute_ReservedPrefixesMatchWholeSegments(t *testing.T) {
	got := Attribute(Input{
		Changed: []string{".qa-evidence-old/x.md", "specs-old/a.ts", "specs"},
		Self:    attrSelf(),
	})
	attrAssertResult(t, got, Result{
		Paths:      []string{".qa-evidence-old/x.md", "specs", "specs-old/a.ts"},
		Undeclared: []string{".qa-evidence-old/x.md", "specs", "specs-old/a.ts"},
	})
}

func TestAttribute_SharedFileChainIncludedForSelf(t *testing.T) {
	got := Attribute(Input{
		Changed: []string{"src/shared.ts"},
		Self:    Item{ID: "WI-1", Stage: "review", Outputs: []string{"src/shared.ts"}},
		Others:  []Item{{ID: "WI-2", Stage: "ready", Outputs: []string{"src/shared.ts"}}},
	})
	attrAssertResult(t, got, Result{Paths: []string{"src/shared.ts"}})
}

func TestAttribute_SharedWithStagedOtherIsDeclaredNotUndeclared(t *testing.T) {
	got := Attribute(Input{
		Changed: []string{"src/shared.ts"},
		Self:    Item{ID: "WI-1", Stage: "review", Outputs: []string{"src/shared.ts"}},
		Others:  []Item{{ID: "WI-2", Stage: "staged", Outputs: []string{"src/shared.ts"}}},
	})
	attrAssertResult(t, got, Result{Paths: []string{"src/shared.ts"}})
}

func TestAttribute_OnlyNonTerminalStagesBlock(t *testing.T) {
	stages := []struct {
		stage  string
		blocks bool
	}{
		{"briefings", true}, {"ready", true}, {"testing", true}, {"implementing", true},
		{"review", true}, {"probing", true}, {"blocked", true},
		{"staged", false}, {"done", false}, {"archived", false},
	}
	for _, tc := range stages {
		t.Run(tc.stage, func(t *testing.T) {
			got := Attribute(Input{
				Changed: []string{"src/x.ts"},
				Self:    attrSelf(),
				Others:  []Item{{ID: "WI-9", Stage: tc.stage, Outputs: []string{"src/x.ts"}}},
			})
			if tc.blocks {
				attrAssertResult(t, got, Result{})
			} else {
				attrAssertResult(t, got, Result{Paths: []string{"src/x.ts"}, Undeclared: []string{"src/x.ts"}})
			}
		})
	}
}

func TestAttribute_EmptyOutputStringsMatchNothing(t *testing.T) {
	got := Attribute(Input{
		Changed: []string{"", "src/a.ts"},
		Self:    attrSelf(),
		Others:  []Item{{ID: "WI-2", Stage: "testing", Outputs: []string{""}}},
	})
	attrAssertResult(t, got, Result{Paths: []string{"src/a.ts"}})
}

func TestAttribute_DeduplicatesAndSorts(t *testing.T) {
	got := Attribute(Input{
		Changed: []string{"src/z.ts", "src/a.ts", "src/z.ts", "src/m.ts", "src/m.ts"},
		Self:    attrSelf(),
	})
	attrAssertResult(t, got, Result{
		Paths:      []string{"src/a.ts", "src/m.ts", "src/z.ts"},
		Undeclared: []string{"src/m.ts", "src/z.ts"},
	})
}

func TestAttribute_ExactPathMatchOnly(t *testing.T) {
	// src/a.ts.bak and src/sub/a.ts are not src/a.ts: they are undeclared.
	got := Attribute(Input{
		Changed: []string{"src/a.ts.bak", "src/sub/a.ts"},
		Self:    attrSelf(),
		Others:  []Item{{ID: "WI-2", Stage: "testing", Outputs: []string{"src/a.ts"}}},
	})
	attrAssertResult(t, got, Result{
		Paths:      []string{"src/a.ts.bak", "src/sub/a.ts"},
		Undeclared: []string{"src/a.ts.bak", "src/sub/a.ts"},
	})
}

func TestAttribute_DeletedPathAttributedByPath(t *testing.T) {
	// A deletion arrives as an ordinary path in Changed (via ParsePorcelain).
	changed := ParsePorcelain([]byte(" D src/a.ts\x00 D src/b.ts\x00 D src/gone.ts\x00"))
	got := Attribute(Input{
		Changed: changed,
		Self:    attrSelf(),
		Others:  []Item{{ID: "WI-2", Stage: "implementing", Outputs: []string{"src/b.ts"}}},
	})
	attrAssertResult(t, got, Result{
		Paths:      []string{"src/a.ts", "src/gone.ts"},
		Undeclared: []string{"src/gone.ts"},
	})
}

func TestParsePorcelain(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want []string
	}{
		{"empty", "", nil},
		{"modified, staged, untracked, deleted",
			" M src/a.ts\x00M  src/b.ts\x00?? src/new.ts\x00 D src/old.ts\x00AM src/c.ts\x00",
			[]string{"src/a.ts", "src/b.ts", "src/new.ts", "src/old.ts", "src/c.ts"}},
		{"rename yields new then old path",
			"R  src/new.ts\x00src/old.ts\x00 M src/a.ts\x00",
			[]string{"src/new.ts", "src/old.ts", "src/a.ts"}},
		{"copy yields both paths",
			"C  src/copy.ts\x00src/orig.ts\x00",
			[]string{"src/copy.ts", "src/orig.ts"}},
		{"spaces and unicode are not quoted under -z",
			"?? dir/my file.ts\x00?? dir/é.ts\x00",
			[]string{"dir/my file.ts", "dir/é.ts"}},
		{"untracked files listed individually, never a collapsed dir",
			"?? pkg/one.ts\x00?? pkg/two.ts\x00",
			[]string{"pkg/one.ts", "pkg/two.ts"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := ParsePorcelain([]byte(tc.in))
			if len(got) == 0 && len(tc.want) == 0 {
				return
			}
			if !reflect.DeepEqual(got, tc.want) {
				t.Fatalf("got %q, want %q", got, tc.want)
			}
		})
	}
}

func TestAttribute_RenameAttributesBothSides(t *testing.T) {
	changed := ParsePorcelain([]byte("R  src/a.ts\x00src/prev.ts\x00"))
	got := Attribute(Input{Changed: changed, Self: attrSelf()})
	attrAssertResult(t, got, Result{
		Paths:      []string{"src/a.ts", "src/prev.ts"},
		Undeclared: []string{"src/prev.ts"},
	})
}

func attrAssertResult(t *testing.T, got, want Result) {
	t.Helper()
	if !attrSameList(got.Paths, want.Paths) {
		t.Errorf("Paths: got %q, want %q", got.Paths, want.Paths)
	}
	if !attrSameList(got.Undeclared, want.Undeclared) {
		t.Errorf("Undeclared: got %q, want %q", got.Undeclared, want.Undeclared)
	}
	if !attrSameList(got.ChangedBaseline, want.ChangedBaseline) {
		t.Errorf("ChangedBaseline: got %q, want %q", got.ChangedBaseline, want.ChangedBaseline)
	}
}

func attrSameList(a, b []string) bool {
	if len(a) == 0 && len(b) == 0 {
		return true
	}
	return reflect.DeepEqual(a, b)
}
