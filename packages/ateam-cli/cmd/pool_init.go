package cmd

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"github.com/spf13/cobra"
)

var poolInitSingleUse bool
var poolInitLanes int

var poolInitCmd = &cobra.Command{
	Use:   "init",
	Short: "Create the local pool directory for the current mission",
	Long: `Creates /tmp/.ateam-pool/$ATEAM_MISSION_ID/ if it doesn't exist.

Idempotent — running twice is a no-op success. Use this at mission start
(Hannibal) or during resume recovery to make sure the pool dir exists before
agents try to claim slots.

--single-use puts the pool in single-use mode (issue #74): agentStop retires a
finished agent's slot instead of returning it to idle, and reports a
"replenish" count of fresh instances the remaining board still needs. The mode
is recorded in the pool dir and persists until 'ateam pool destroy'; running
init again without the flag does not turn it off.

--lanes N records the configured lane count N — the memory- and dep-graph-
bound concurrency limit 'ateam scaling compute' derives — alongside single-use
mode. computeReplenish then caps its count so idle+busy+count never exceeds N,
in addition to the target stage's own WIP limit: a stage's default WIP limit
(3) is independent of N, so with a tight N (e.g. 1) replenish could otherwise
report spawning more instances than the mission's memory budget allows.
Requires --single-use (a reuse-mode pool has no replenish concept to cap).
'ateam pool replenish <agentType>' recomputes the same capped count on demand,
for the orchestrator to call immediately before each spawn.

In --json mode the output shape is:
  { "missionId": "M-...", "poolDir": "/tmp/.ateam-pool/M-...", "created": true, "singleUse": false, "lanes": 2 }

The "created" field reports whether the directory was newly made (true) or
already existed (false). Either case exits 0. "singleUse" reports the pool's
mode after the call. "lanes" is present only when a lane count is configured.`,
	Args: cobra.NoArgs,
	RunE: func(cmd *cobra.Command, args []string) error {
		missionID := os.Getenv("ATEAM_MISSION_ID")
		if err := validateMissionID(missionID); err != nil {
			return err
		}
		if cmd.Flags().Changed("lanes") && !poolInitSingleUse {
			return fmt.Errorf("--lanes requires --single-use")
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
		if poolInitSingleUse {
			marker := filepath.Join(poolDir, singleUseMarker)
			if err := os.WriteFile(marker, []byte("single-use\n"), 0644); err != nil {
				return fmt.Errorf("write single-use marker %s: %w", marker, err)
			}
		}
		if cmd.Flags().Changed("lanes") {
			if err := writeLanes(poolDir, poolInitLanes); err != nil {
				return fmt.Errorf("write lanes marker in %s: %w", poolDir, err)
			}
		}
		singleUse := poolIsSingleUse(poolDir)
		lanes := poolLanes(poolDir)

		jsonMode, _ := cmd.Root().PersistentFlags().GetBool("json")
		if jsonMode {
			out := map[string]interface{}{
				"missionId": missionID,
				"poolDir":   poolDir,
				"created":   created,
				"singleUse": singleUse,
			}
			if lanes > 0 {
				out["lanes"] = lanes
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
		if singleUse {
			fmt.Fprintln(cmd.OutOrStdout(), "Mode: single-use (finished agents retire; agentStop reports replenish)")
		}
		if lanes > 0 {
			fmt.Fprintf(cmd.OutOrStdout(), "Lanes: %d (replenish caps idle+busy+spawn at this count)\n", lanes)
		}
		return nil
	},
}

func init() {
	poolCmd.AddCommand(poolInitCmd)
	poolInitCmd.Flags().BoolVar(&poolInitSingleUse, "single-use", false, "Retire each agent after one item instead of returning it to idle (issue #74)")
	poolInitCmd.Flags().IntVar(&poolInitLanes, "lanes", 0, "Cap replenish at N concurrent instances per agent type; requires --single-use (0 = no cap)")
}
