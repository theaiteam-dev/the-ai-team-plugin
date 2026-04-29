package cmd

import (
	"errors"
	"strings"
	"testing"
)

// TestValidateMissionID covers the unit-level helper. Each verb additionally
// has a "rejects traversal" case in its own *_test.go to confirm the helper
// is wired in before any FS access.
func TestValidateMissionID(t *testing.T) {
	cases := []struct {
		name       string
		id         string
		wantErr    bool
		wantSubstr string
	}{
		// Allowed
		{name: "simple alphanumeric", id: "M-123", wantErr: false},
		{name: "with underscores and dots", id: "M_test.1-2", wantErr: false},
		{name: "all hyphen", id: "a-b-c", wantErr: false},

		// Rejected
		{name: "empty", id: "", wantErr: true, wantSubstr: "ATEAM_MISSION_ID"},
		{name: "only dots traversal", id: "..", wantErr: true, wantSubstr: "traversal"},
		{name: "embedded traversal", id: "../etc", wantErr: true, wantSubstr: "/"}, // hits separator first
		{name: "leading traversal segment", id: "..foo", wantErr: true, wantSubstr: "traversal"},
		{name: "forward slash", id: "foo/bar", wantErr: true, wantSubstr: "/"},
		{name: "backslash", id: "foo\\bar", wantErr: true, wantSubstr: "separator"},
		{name: "NUL byte", id: "foo\x00bar", wantErr: true, wantSubstr: "NUL"},
		{name: "space", id: "foo bar", wantErr: true, wantSubstr: "must match"},
		{name: "newline", id: "foo\nbar", wantErr: true, wantSubstr: "must match"},
		{name: "wildcard", id: "foo*", wantErr: true, wantSubstr: "must match"},
		{name: "tilde", id: "~foo", wantErr: true, wantSubstr: "must match"},
		{name: "single dot alone", id: ".", wantErr: true, wantSubstr: "traversal"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := validateMissionID(tc.id)
			if tc.wantErr {
				if err == nil {
					t.Fatalf("expected error for id=%q, got nil", tc.id)
				}
				// All validation errors must be PoolError with exit code 1.
				var pe *PoolError
				if !errors.As(err, &pe) {
					t.Fatalf("expected *PoolError, got %T: %v", err, err)
				}
				if pe.ExitCode != PoolExitGeneric {
					t.Errorf("expected exit code %d, got %d", PoolExitGeneric, pe.ExitCode)
				}
				if tc.wantSubstr != "" && !strings.Contains(err.Error(), tc.wantSubstr) {
					t.Errorf("expected error to mention %q, got: %v", tc.wantSubstr, err)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error for id=%q: %v", tc.id, err)
			}
		})
	}
}
