package cmd

import (
	"fmt"
	"net/http"
	"os"
	"strings"

	"ateam/internal/client"

	"github.com/spf13/cobra"
)

var (
	checkpointConfirmMissionID string
	checkpointConfirmActionID  string
)

var checkpointConfirmCmd = &cobra.Command{
	Use:          "confirm",
	Short:        "Atomically append an action ID to confirmedActionIds",
	Long: `POSTs {"actionId": "<id>"} to
/api/controller-checkpoint/<missionId>/confirm.

The server owns the atomic append — the CLI never does a client-side
read-modify-write. Exits non-zero before any HTTP call when --action-id
is missing or empty. Surfaces a 404 (no checkpoint exists yet) with the
sentinel "no checkpoint found for mission <id>".`,
	SilenceUsage: true,
	Args:         cobra.NoArgs,
	RunE: func(cmd *cobra.Command, args []string) error {
		baseURL, _ := cmd.Root().PersistentFlags().GetString("base-url")

		missionID := checkpointConfirmMissionID
		if missionID == "" {
			missionID = os.Getenv("ATEAM_MISSION_ID")
		}

		// Guard: --action-id must be provided and non-empty.
		if checkpointConfirmActionID == "" {
			return fmt.Errorf("--action-id is required and must not be empty")
		}

		cli := client.NewClient(baseURL, "")
		confirmPath := "/api/controller-checkpoint/" + missionID + "/confirm"
		_, err := cli.Do(http.MethodPost, confirmPath, nil, nil, map[string]string{"actionId": checkpointConfirmActionID})
		if err != nil {
			if strings.Contains(err.Error(), "unexpected status 404") {
				return fmt.Errorf("no checkpoint found for mission %s", missionID)
			}
			return fmt.Errorf("POST confirm: %w", err)
		}

		fmt.Fprintf(cmd.OutOrStdout(), "Confirmed action %s for mission %s\n",
			checkpointConfirmActionID, missionID)
		return nil
	},
}

func init() {
	checkpointCmd.AddCommand(checkpointConfirmCmd)
	checkpointConfirmCmd.Flags().StringVar(&checkpointConfirmMissionID, "mission-id", "",
		"Mission ID to target (overrides $ATEAM_MISSION_ID)")
	checkpointConfirmCmd.Flags().StringVar(&checkpointConfirmActionID, "action-id", "",
		"Action ID to append to confirmedActionIds")
}
