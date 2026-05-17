package cmd

import (
	"encoding/json"
	"fmt"
	"os"

	"ateam/internal/controller"

	"github.com/spf13/cobra"
)

var (
	tickCmdDryRun    bool
	tickCmdMissionID string
)

var tickCmd = &cobra.Command{
	Use:   "tick",
	Short: "Compute the next controller action plan for the active mission",
	Long: `Reads board / pool / dependency state from the kanban-viewer API
and emits a JSON plan on stdout. The Hannibal orchestrator executes
the plan each clock cycle.

Output shape:
  {
    "missionId":       "M-...",
    "mode":            "native-teams" | "legacy",
    "state":           "running" | "completed" | ...,
    "nextWakeSeconds": 5,
    "summary":         "...",
    "actions":         [...],
    "messages":        [],
    "needsJudgment":   null | { "reason": "..." }
  }

With --dry-run the plan is printed but no activity-log entries or
checkpoint updates are written.

Fail-closed: if the API is unreachable or returns malformed JSON,
the command exits non-zero and emits a needsJudgment payload (still
as JSON) so the consumer can read the reason without shell-parsing.`,
	SilenceUsage: true,
	Args:         cobra.NoArgs,
	RunE: func(cmd *cobra.Command, args []string) error {
		baseURL, _ := cmd.Root().PersistentFlags().GetString("base-url")
		jsonMode, _ := cmd.Root().PersistentFlags().GetBool("json")

		missionID := tickCmdMissionID
		if missionID == "" {
			missionID = os.Getenv("ATEAM_MISSION_ID")
		}

		mode := controller.ModeFromEnv()
		projectID := os.Getenv("ATEAM_PROJECT_ID")

		cfg := controller.Config{
			BaseURL:   baseURL,
			MissionID: missionID,
			Mode:      mode,
			DryRun:    tickCmdDryRun,
			ProjectID: projectID,
		}

		plan, planErr := controller.NewPlanner(cfg).Tick()

		// Always print the plan — even on failure, the consumer reads
		// needsJudgment from the fail-closed payload.
		if err := printTickOutput(cmd, plan, jsonMode); err != nil {
			return err
		}

		return planErr
	},
}

// printTickOutput marshals plan to JSON and writes it to cmd's output stream.
func printTickOutput(cmd *cobra.Command, plan *controller.TickOutput, jsonMode bool) error {
	// We always emit JSON for the tick command regardless of the --json flag,
	// because the output is structured data (the orchestrator depends on it).
	// The --json flag is still accepted (for consistency with the rest of the
	// CLI) but does not change the output format.
	_ = jsonMode
	b, err := json.MarshalIndent(plan, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal tick output: %w", err)
	}
	fmt.Fprintln(cmd.OutOrStdout(), string(b))
	return nil
}

func init() {
	controllerCmd.AddCommand(tickCmd)
	tickCmd.Flags().BoolVar(&tickCmdDryRun, "dry-run", false,
		"Print the action plan without writing activity-log entries or a checkpoint")
	tickCmd.Flags().StringVar(&tickCmdMissionID, "mission-id", "",
		"Mission ID (overrides $ATEAM_MISSION_ID)")
}
