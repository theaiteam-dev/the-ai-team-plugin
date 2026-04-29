package cmd

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"github.com/spf13/cobra"
)

var poolReleaseCmd = &cobra.Command{
	Use:   "release <instance>",
	Short: "Force-release a presumed-dead instance's busy slot back to idle",
	Long: `Atomically renames /tmp/.ateam-pool/$ATEAM_MISSION_ID/<instance>.busy to
<instance>.idle. ALWAYS prints a POOL_WARN to stderr — this is the
"agent is presumed dead" path, not the normal completion path.

Used ONLY by Hannibal's dispatch-timeout recovery. Healthy agents release
their own slot inside 'ateam agents-stop agentStop'; this verb is the
escape hatch for when an agent crashes before it can self-release.

Errors when:
  - <instance>.busy does not exist (nothing to release)
  - <instance>.idle already exists (would clobber a live idle marker)
  - ATEAM_MISSION_ID is unset

In --json mode the output shape is:
  { "instance": "murdock-1", "state": "idle", "warned": true }`,
	Args: cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		instance := args[0]
		missionID := os.Getenv("ATEAM_MISSION_ID")
		if err := validateMissionID(missionID); err != nil {
			return err
		}
		poolDir := filepath.Join("/tmp", ".ateam-pool", missionID)
		busyFile := filepath.Join(poolDir, instance+".busy")
		idleFile := filepath.Join(poolDir, instance+".idle")

		if _, err := os.Stat(busyFile); err != nil {
			if os.IsNotExist(err) {
				return fmt.Errorf("%s.busy does not exist — nothing to release", instance)
			}
			return fmt.Errorf("stat %s: %w", busyFile, err)
		}

		if _, err := os.Stat(idleFile); err == nil {
			return fmt.Errorf("%s.idle already exists — refusing to clobber; resolve manually", instance)
		} else if !os.IsNotExist(err) {
			return fmt.Errorf("stat %s: %w", idleFile, err)
		}

		// Loud stderr warning BEFORE the rename so it's visible even if rename fails.
		fmt.Fprintf(cmd.ErrOrStderr(), "POOL_WARN: force-releasing %s — agent presumed dead\n", instance)

		if err := os.Rename(busyFile, idleFile); err != nil {
			return fmt.Errorf("rename %s → %s: %w", busyFile, idleFile, err)
		}

		jsonMode, _ := cmd.Root().PersistentFlags().GetBool("json")
		if jsonMode {
			out := map[string]interface{}{
				"instance": instance,
				"state":    "idle",
				"warned":   true,
			}
			b, err := json.MarshalIndent(out, "", "  ")
			if err != nil {
				return err
			}
			fmt.Fprintln(cmd.OutOrStdout(), string(b))
			return nil
		}

		fmt.Fprintf(cmd.OutOrStdout(), "Released %s: %s → %s\n", instance, busyFile, idleFile)
		return nil
	},
}

func init() {
	poolCmd.AddCommand(poolReleaseCmd)
}
