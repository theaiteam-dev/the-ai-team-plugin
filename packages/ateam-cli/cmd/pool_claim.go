package cmd

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"syscall"

	"github.com/spf13/cobra"
)

// sameInode reports whether two FileInfo values refer to the same underlying
// inode. Used to tell a transient mid-claim race state ("busy and idle
// hardlinked from os.Link") apart from genuine corruption (two independent
// files). Returns false on platforms where the underlying stat structure
// can't be inspected (Windows) — on those platforms the caller falls
// through to the corruption code, which is the safer default.
func sameInode(a, b os.FileInfo) bool {
	if a == nil || b == nil {
		return false
	}
	sa, ok := a.Sys().(*syscall.Stat_t)
	if !ok {
		return false
	}
	sb, ok := b.Sys().(*syscall.Stat_t)
	if !ok {
		return false
	}
	return sa.Dev == sb.Dev && sa.Ino == sb.Ino
}

var poolClaimCmd = &cobra.Command{
	Use:   "claim <instance>",
	Short: "Atomically claim an idle pool slot (.idle → .busy)",
	Long: `Atomically claims /tmp/.ateam-pool/$ATEAM_MISSION_ID/<instance>.idle by
hard-linking it to <instance>.busy and unlinking the .idle entry — exactly
one caller wins under contention. The link primitive (unlike rename) refuses
to clobber an existing .busy file, which makes corruption detectable
post-hoc via inode comparison.

This is the agent-side self-claim verb: a pipeline agent (Murdock, B.A.,
Lynch, Amy) calls it when it receives a START message and is about to begin
work, before invoking 'ateam agents-start agentStart'.

Exit codes (stable contract — see scripts/skills/pool-handoff):
  0 = success
  1 = generic / unexpected error
  2 = already claimed (the pre-claimed-by-upstream-agentStop case — treat
      as success in pool-handoff)
  3 = no such instance (neither .idle nor .busy exists)
  4 = corrupted state (both .idle and .busy exist)
  5 = pool dir does not exist

Does NOT print POOL_WARN — claim is the normal hot path. Only 'pool release'
warns (it's the agent-presumed-dead recovery path).

In --json mode the output shape is:
  { "instance": "murdock-1", "state": "busy", "path": "/tmp/.ateam-pool/M-.../murdock-1.busy" }`,
	Args: cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		instance := args[0]
		missionID := os.Getenv("ATEAM_MISSION_ID")
		if err := validateMissionID(missionID); err != nil {
			return err
		}
		poolDir := filepath.Join("/tmp", ".ateam-pool", missionID)

		if _, err := os.Stat(poolDir); err != nil {
			if os.IsNotExist(err) {
				return newPoolError(PoolExitPoolDirMissing,
					"pool dir %s does not exist — run 'ateam pool init' first", poolDir)
			}
			return newPoolError(PoolExitGeneric, "stat pool dir %s: %v", poolDir, err)
		}

		idleFile := filepath.Join(poolDir, instance+".idle")
		busyFile := filepath.Join(poolDir, instance+".busy")

		// Atomic claim via hard-link + unlink. os.Link is the right primitive
		// here — unlike os.Rename, it FAILS with EEXIST when the destination
		// already exists, so a concurrent claim that already produced .busy
		// won't be silently clobbered. After a successful link, .busy and
		// .idle point at the same inode; we then unlink .idle to leave only
		// .busy, matching the pool-handoff invariant.
		//
		// Race breakdown for two concurrent processes A and B:
		//   - A links → success; A unlinks .idle.
		//   - B links → EEXIST (target exists) OR ENOENT (.idle gone after A unlinked).
		// Either way, exactly one wins. The post-failure stat below maps the
		// kernel error to the documented exit code.
		linkErr := os.Link(idleFile, busyFile)
		if linkErr == nil {
			// Won the race. Drop the .idle hardlink so only .busy remains.
			// If unlink fails (e.g. another process raced ahead and removed
			// .idle, or unlink hit a transient error), the slot is still
			// claimed correctly — surface as a generic error only on real
			// failures, not on the benign "already gone" case.
			if unlinkErr := os.Remove(idleFile); unlinkErr != nil && !os.IsNotExist(unlinkErr) {
				return newPoolError(PoolExitGeneric,
					"claimed %s but failed to unlink %s.idle: %v", instance, instance, unlinkErr)
			}
			jsonMode, _ := cmd.Root().PersistentFlags().GetBool("json")
			if jsonMode {
				out := map[string]interface{}{
					"instance": instance,
					"state":    "busy",
					"path":     busyFile,
				}
				b, err := json.MarshalIndent(out, "", "  ")
				if err != nil {
					return newPoolError(PoolExitGeneric, "marshal json: %v", err)
				}
				fmt.Fprintln(cmd.OutOrStdout(), string(b))
				return nil
			}
			fmt.Fprintf(cmd.OutOrStdout(), "Claimed %s: %s → %s\n", instance, idleFile, busyFile)
			return nil
		}

		// Link failed. Distinguish the cases via stat + inode link count.
		//
		// The link-count trick is the key to disambiguating a race ("both
		// files exist transiently because another process is mid-claim, so
		// .busy and .idle share an inode with nlink=2") from genuine
		// corruption ("both files exist independently with nlink=1 each").
		// Without it, a single-snapshot stat can't tell them apart and we
		// either mis-classify races as corruption or vice versa.
		if !errors.Is(linkErr, os.ErrExist) && !errors.Is(linkErr, os.ErrNotExist) {
			// Some other failure (permission, EXDEV, EIO, etc.) — generic.
			return newPoolError(PoolExitGeneric, "link %s → %s: %v", idleFile, busyFile, linkErr)
		}

		idleInfo, idleStatErr := os.Stat(idleFile)
		busyInfo, busyStatErr := os.Stat(busyFile)
		idleExists := idleStatErr == nil
		busyExists := busyStatErr == nil

		if idleStatErr != nil && !os.IsNotExist(idleStatErr) {
			return newPoolError(PoolExitGeneric, "stat %s: %v", idleFile, idleStatErr)
		}
		if busyStatErr != nil && !os.IsNotExist(busyStatErr) {
			return newPoolError(PoolExitGeneric, "stat %s: %v", busyFile, busyStatErr)
		}

		switch {
		case idleExists && busyExists:
			// Both present. If .idle and .busy share an inode (i.e. .busy
			// has nlink>1 or both stats report the same inode), this is a
			// transient race state from a competing claimer's mid-flight
			// link → unlink — treat as already-claimed. Otherwise it is
			// real corruption (independently-created files).
			if sameInode(idleInfo, busyInfo) {
				return newPoolError(PoolExitAlreadyClaimed,
					"%s already claimed — competing claim is mid-flight (.busy and .idle share inode)", instance)
			}
			return newPoolError(PoolExitCorruptedState,
				"corrupted state: both %s.idle and %s.busy exist with distinct inodes — investigate before retrying", instance, instance)
		case busyExists:
			return newPoolError(PoolExitAlreadyClaimed,
				"%s already claimed — %s.busy exists (lost a race or double-claim)", instance, instance)
		case idleExists:
			// link returned an error but .idle is now visible. The caller
			// raced on .idle disappearing then reappearing — treat as
			// already-claimed-ish so they don't loop forever.
			return newPoolError(PoolExitAlreadyClaimed,
				"%s claim raced on %s.idle disappearing then reappearing; try again", instance, instance)
		default:
			return newPoolError(PoolExitNoSuchInstance,
				"no such instance %s — was 'ateam pool mark-idle %s' ever run?", instance, instance)
		}
	},
}

func init() {
	poolCmd.AddCommand(poolClaimCmd)
}
