package cmd

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"github.com/spf13/cobra"
)

var poolInitCmd = &cobra.Command{
	Use:   "init",
	Short: "Create the local pool directory for the current mission",
	Long: `Creates /tmp/.ateam-pool/$ATEAM_MISSION_ID/ if it doesn't exist.

Idempotent — running twice is a no-op success. Use this at mission start
(Hannibal) or during resume recovery to make sure the pool dir exists before
agents try to claim slots.

In --json mode the output shape is:
  { "missionId": "M-...", "poolDir": "/tmp/.ateam-pool/M-...", "created": true }

The "created" field reports whether the directory was newly made (true) or
already existed (false). Either case exits 0.`,
	Args: cobra.NoArgs,
	RunE: func(cmd *cobra.Command, args []string) error {
		missionID := os.Getenv("ATEAM_MISSION_ID")
		if err := validateMissionID(missionID); err != nil {
			return err
		}
		poolDir := filepath.Join("/tmp", ".ateam-pool", missionID)

		created := true
		if _, err := os.Stat(poolDir); err == nil {
			created = false
		} else if !os.IsNotExist(err) {
			return fmt.Errorf("stat pool dir %s: %w", poolDir, err)
		}

		if err := os.MkdirAll(poolDir, 0755); err != nil {
			return fmt.Errorf("mkdir pool dir %s: %w", poolDir, err)
		}

		jsonMode, _ := cmd.Root().PersistentFlags().GetBool("json")
		if jsonMode {
			out := map[string]interface{}{
				"missionId": missionID,
				"poolDir":   poolDir,
				"created":   created,
			}
			b, err := json.MarshalIndent(out, "", "  ")
			if err != nil {
				return err
			}
			fmt.Fprintln(cmd.OutOrStdout(), string(b))
			return nil
		}

		if created {
			fmt.Fprintf(cmd.OutOrStdout(), "Created pool dir: %s\n", poolDir)
		} else {
			fmt.Fprintf(cmd.OutOrStdout(), "Pool dir already exists: %s\n", poolDir)
		}
		return nil
	},
}

func init() {
	poolCmd.AddCommand(poolInitCmd)
}
