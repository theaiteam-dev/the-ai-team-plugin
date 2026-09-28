package cmd

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"ateam/internal/client"

	"github.com/spf13/cobra"
)

var poolReplenishCmd = &cobra.Command{
	Use:   "replenish <agentType>",
	Short: "Recompute how many fresh instances of an agent type the board still needs",
	Long: `Computes the single-use replenish fact for agentType (murdock|ba|lynch|amy)
from the current mission's board and pool state — the same computeReplenish
call agentStop makes when an instance of that type completes an item.

This is the orchestrator's immediate-pre-spawn check. agentStop reports a
replenish count at the moment an instance finishes, but that count can go
stale before a replacement is actually spawned: a second agentStop landing in
that window would recompute against a pool that doesn't yet show the
still-starting replacement, and report the same headroom again, risking a
double spawn. Call 'ateam pool replenish <agentType>' right before spawning
each instance so the count reflects the pool and board as they are then, not
as they were when an earlier agentStop reported.

Errors when the pool is not single-use (reuse mode has no replenish concept)
or when agentType has no pipeline stage (only murdock, ba, lynch, and amy do).

In --json mode the output is the same replenishInfo shape agentStop reports
under data.replenish:
  { "agentType": "ba", "count": 1, "demand": 3, "idle": 0, "busy": 1, "parked": 0, "wipLimit": 3, "lanes": 2 }

"lanes" is present only when the pool was initialized with 'pool init
--single-use --lanes N'.`,
	Args: cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		role := agentType(args[0])
		missionID := os.Getenv("ATEAM_MISSION_ID")
		if err := validateMissionID(missionID); err != nil {
			return err
		}
		poolDir := filepath.Join("/tmp", ".ateam-pool", missionID)

		if _, err := os.Stat(poolDir); err != nil {
			if os.IsNotExist(err) {
				return newPoolError(PoolExitPoolDirMissing,
					"pool dir %s does not exist — run 'ateam pool init --single-use' first", poolDir)
			}
			return newPoolError(PoolExitGeneric, "stat pool dir %s: %v", poolDir, err)
		}
		if !poolIsSingleUse(poolDir) {
			return newPoolError(PoolExitGeneric,
				"pool at %s is not single-use — replenish only applies in single-use mode", poolDir)
		}
		if _, ok := agentStage[role]; !ok {
			return newPoolError(PoolExitGeneric,
				"no pipeline stage for agent type %q (expected murdock, ba, lynch, or amy)", args[0])
		}

		baseURL, _ := cmd.Root().PersistentFlags().GetString("base-url")
		token := os.Getenv("ATEAM_TOKEN")
		c := client.NewClient(baseURL, token)
		board, err := c.Do("GET", "/api/board", map[string]string{}, map[string]string{}, nil)
		if err != nil {
			return newPoolError(PoolExitGeneric, "fetch board: %v", err)
		}
		info, err := computeReplenish(board, poolDir, role)
		if err != nil {
			return newPoolError(PoolExitGeneric, "%v", err)
		}

		jsonMode, _ := cmd.Root().PersistentFlags().GetBool("json")
		if jsonMode {
			b, err := json.MarshalIndent(info, "", "  ")
			if err != nil {
				return newPoolError(PoolExitGeneric, "marshal json: %v", err)
			}
			fmt.Fprintln(cmd.OutOrStdout(), string(b))
			return nil
		}

		fmt.Fprintf(cmd.OutOrStdout(), "%s: spawn %d (demand=%d idle=%d busy=%d parked=%d)\n",
			info.AgentType, info.Count, info.Demand, info.Idle, info.Busy, info.Parked)
		return nil
	},
}

func init() {
	poolCmd.AddCommand(poolReplenishCmd)
}
