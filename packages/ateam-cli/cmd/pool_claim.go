package cmd

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"github.com/spf13/cobra"
)

var poolClaimCmd = &cobra.Command{
	Use:   "claim <instance>",
	Short: "Atomically claim an idle pool slot (.idle → .busy)",
	Long: `Atomically renames /tmp/.ateam-pool/$ATEAM_MISSION_ID/<instance>.idle to
<instance>.busy via os.Rename — exactly one caller wins under contention.

This is the agent-side self-claim verb: a pipeline agent (Murdock, B.A.,
Lynch, Amy) calls it when it receives a START message and is about to begin
work, before invoking 'ateam agents-start agentStart'.

Errors when:
  - ATEAM_MISSION_ID is unset
  - Pool dir does not exist (caller forgot 'pool init')
  - <instance>.idle missing AND <instance>.busy exists → slot already claimed
    (lost the race or double-claim)
  - <instance>.idle missing AND <instance>.busy missing → no such instance
    (was 'pool mark-idle <instance>' ever run?)
  - Both <instance>.idle and <instance>.busy exist (corrupted state)

Does NOT print POOL_WARN — claim is the normal hot path. Only 'pool release'
warns (it's the agent-presumed-dead recovery path).

In --json mode the output shape is:
  { "instance": "murdock-1", "state": "busy", "path": "/tmp/.ateam-pool/M-.../murdock-1.busy" }`,
	Args: cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		instance := args[0]
		missionID := os.Getenv("ATEAM_MISSION_ID")
		if missionID == "" {
			return fmt.Errorf("ATEAM_MISSION_ID is not set — pool state is per-mission")
		}
		poolDir := filepath.Join("/tmp", ".ateam-pool", missionID)

		if _, err := os.Stat(poolDir); err != nil {
			if os.IsNotExist(err) {
				return fmt.Errorf("pool dir %s does not exist — run 'ateam pool init' first", poolDir)
			}
			return fmt.Errorf("stat pool dir %s: %w", poolDir, err)
		}

		idleFile := filepath.Join(poolDir, instance+".idle")
		busyFile := filepath.Join(poolDir, instance+".busy")

		_, idleErr := os.Stat(idleFile)
		_, busyErr := os.Stat(busyFile)
		idleExists := idleErr == nil
		busyExists := busyErr == nil

		if !idleExists && idleErr != nil && !os.IsNotExist(idleErr) {
			return fmt.Errorf("stat %s: %w", idleFile, idleErr)
		}
		if !busyExists && busyErr != nil && !os.IsNotExist(busyErr) {
			return fmt.Errorf("stat %s: %w", busyFile, busyErr)
		}

		if idleExists && busyExists {
			return fmt.Errorf("corrupted state: both %s.idle and %s.busy exist — investigate before retrying", instance, instance)
		}
		if !idleExists && busyExists {
			return fmt.Errorf("%s already claimed — %s.busy exists (lost a race or double-claim)", instance, instance)
		}
		if !idleExists && !busyExists {
			return fmt.Errorf("no such instance %s — was 'ateam pool mark-idle %s' ever run?", instance, instance)
		}

		// idleExists && !busyExists → atomic rename. os.Rename is the
		// race-safe primitive: under concurrent callers, exactly one wins
		// and the others get ENOENT.
		if err := os.Rename(idleFile, busyFile); err != nil {
			if os.IsNotExist(err) {
				return fmt.Errorf("%s already claimed — lost the race between stat and rename", instance)
			}
			return fmt.Errorf("rename %s → %s: %w", idleFile, busyFile, err)
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
				return err
			}
			fmt.Fprintln(cmd.OutOrStdout(), string(b))
			return nil
		}

		fmt.Fprintf(cmd.OutOrStdout(), "Claimed %s: %s → %s\n", instance, idleFile, busyFile)
		return nil
	},
}

func init() {
	poolCmd.AddCommand(poolClaimCmd)
}
