package cmd

import (
	"fmt"
	"regexp"
	"strings"

	"github.com/spf13/cobra"
)

var poolCmd = &cobra.Command{
	Use:   "pool",
	Short: "Inspect the local file-based instance pool",
}

// Pool exit-code contract (stable; consumed by the pool-handoff skill and any
// shell scripts that drive `ateam pool ...`).
//
//	0 = success
//	1 = generic / unexpected (cobra default for any RunE error not categorized)
//	2 = already claimed (slot was pre-claimed by upstream agentStop — treat as success)
//	3 = no such instance (.idle and .busy both missing)
//	4 = corrupted state (.idle and .busy both present)
//	5 = pool dir does not exist
const (
	PoolExitOK              = 0
	PoolExitGeneric         = 1
	PoolExitAlreadyClaimed  = 2
	PoolExitNoSuchInstance  = 3
	PoolExitCorruptedState  = 4
	PoolExitPoolDirMissing  = 5
)

// PoolError carries a human-readable message PLUS the stable exit code that
// the verb should terminate with. Verbs return this from RunE; rootCmd's
// Execute() inspects it and calls os.Exit with ExitCode.
type PoolError struct {
	ExitCode int
	Message  string
}

func (e *PoolError) Error() string { return e.Message }

func newPoolError(code int, format string, a ...interface{}) *PoolError {
	return &PoolError{ExitCode: code, Message: fmt.Sprintf(format, a...)}
}

// missionIDRegexp restricts mission IDs to a conservative alphanumeric set
// plus underscore, dot, and hyphen. This rejects path separators, traversal
// sequences, NUL bytes, whitespace, and anything else that could escape
// /tmp/.ateam-pool/<id> or otherwise produce surprising filesystem paths.
var missionIDRegexp = regexp.MustCompile(`^[A-Za-z0-9_.-]+$`)

// validateMissionID rejects mission IDs that could cause path traversal or
// otherwise produce surprising filesystem operations. Called by every pool
// verb immediately after reading $ATEAM_MISSION_ID and BEFORE any FS access.
//
// Returns an error whose exit code is PoolExitGeneric (1) — bad input is a
// configuration / caller bug, not one of the documented pool-state outcomes.
func validateMissionID(id string) error {
	if id == "" {
		return newPoolError(PoolExitGeneric, "ATEAM_MISSION_ID is not set — pool state is per-mission")
	}
	if strings.ContainsAny(id, "/\\\x00") {
		return newPoolError(PoolExitGeneric, "ATEAM_MISSION_ID %q contains an invalid character (path separator or NUL)", id)
	}
	if id == ".." || id == "." || strings.Contains(id, "..") {
		return newPoolError(PoolExitGeneric, "ATEAM_MISSION_ID %q contains a traversal sequence (..)", id)
	}
	if !missionIDRegexp.MatchString(id) {
		return newPoolError(PoolExitGeneric, "ATEAM_MISSION_ID %q must match %s", id, missionIDRegexp.String())
	}
	return nil
}

func init() {
	rootCmd.AddCommand(poolCmd)
}
