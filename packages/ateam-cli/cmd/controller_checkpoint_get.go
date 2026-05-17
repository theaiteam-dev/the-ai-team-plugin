package cmd

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"

	"ateam/internal/client"

	"github.com/spf13/cobra"
)

var checkpointGetMissionID string

var checkpointGetCmd = &cobra.Command{
	Use:          "get",
	Short:        "Print the persisted checkpoint document for a mission",
	Long: `GETs /api/controller-checkpoint/<missionId> and prints the data
field of the API envelope as JSON on stdout.

Exits non-zero with a clear stderr message when no checkpoint exists
yet (HTTP 404), distinguishing "never ticked" from a transport error.`,
	SilenceUsage: true,
	Args:         cobra.NoArgs,
	RunE: func(cmd *cobra.Command, args []string) error {
		baseURL, _ := cmd.Root().PersistentFlags().GetString("base-url")

		missionID := checkpointGetMissionID
		if missionID == "" {
			missionID = os.Getenv("ATEAM_MISSION_ID")
		}

		cli := client.NewClient(baseURL, "")
		body, err := cli.Do(http.MethodGet, "/api/controller-checkpoint/"+missionID, nil, nil, nil)
		if err != nil {
			if strings.Contains(err.Error(), "unexpected status 404") {
				return fmt.Errorf("no checkpoint found for mission %s", missionID)
			}
			return fmt.Errorf("GET checkpoint: %w", err)
		}

		var envelope struct {
			Success bool            `json:"success"`
			Data    json.RawMessage `json:"data"`
		}
		if err := json.Unmarshal(body, &envelope); err != nil {
			return fmt.Errorf("decode checkpoint envelope: %w", err)
		}

		var pretty bytes.Buffer
		if err := json.Indent(&pretty, envelope.Data, "", "  "); err != nil {
			fmt.Fprintln(cmd.OutOrStdout(), string(envelope.Data))
		} else {
			fmt.Fprintln(cmd.OutOrStdout(), pretty.String())
		}
		return nil
	},
}

func init() {
	checkpointCmd.AddCommand(checkpointGetCmd)
	checkpointGetCmd.Flags().StringVar(&checkpointGetMissionID, "mission-id", "",
		"Mission ID to target (overrides $ATEAM_MISSION_ID)")
}
