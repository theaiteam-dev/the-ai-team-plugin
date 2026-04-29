package cmd

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"github.com/spf13/cobra"
)

var poolDestroyCmd = &cobra.Command{
	Use:   "destroy",
	Short: "Remove the local pool directory for the current mission",
	Long: `Removes /tmp/.ateam-pool/$ATEAM_MISSION_ID/ and everything inside it.

Idempotent — succeeds whether or not the directory exists. Refuses to run
when ATEAM_MISSION_ID is unset (won't nuke unscoped paths).

Used at mission end (Tawnia/Hannibal cleanup) and during resume recovery
(paired with 'pool init' to rebuild from scratch).

In --json mode the output shape is:
  { "missionId": "M-...", "poolDir": "/tmp/.ateam-pool/M-...", "removed": true }

The "removed" field reports whether the directory actually existed (true)
or was already gone (false). Either case exits 0.`,
	Args: cobra.NoArgs,
	RunE: func(cmd *cobra.Command, args []string) error {
		missionID := os.Getenv("ATEAM_MISSION_ID")
		if missionID == "" {
			return fmt.Errorf("ATEAM_MISSION_ID is not set — refusing to remove unscoped pool path")
		}
		poolDir := filepath.Join("/tmp", ".ateam-pool", missionID)

		removed := true
		if _, err := os.Stat(poolDir); err != nil {
			if os.IsNotExist(err) {
				removed = false
			} else {
				return fmt.Errorf("stat pool dir %s: %w", poolDir, err)
			}
		}

		if removed {
			if err := os.RemoveAll(poolDir); err != nil {
				return fmt.Errorf("remove pool dir %s: %w", poolDir, err)
			}
		}

		jsonMode, _ := cmd.Root().PersistentFlags().GetBool("json")
		if jsonMode {
			out := map[string]interface{}{
				"missionId": missionID,
				"poolDir":   poolDir,
				"removed":   removed,
			}
			b, err := json.MarshalIndent(out, "", "  ")
			if err != nil {
				return err
			}
			fmt.Fprintln(cmd.OutOrStdout(), string(b))
			return nil
		}

		if removed {
			fmt.Fprintf(cmd.OutOrStdout(), "Removed pool dir: %s\n", poolDir)
		} else {
			fmt.Fprintf(cmd.OutOrStdout(), "Pool dir already gone: %s\n", poolDir)
		}
		return nil
	},
}

func init() {
	poolCmd.AddCommand(poolDestroyCmd)
}
