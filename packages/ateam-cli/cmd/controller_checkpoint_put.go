package cmd

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"os"

	"ateam/internal/client"

	"github.com/spf13/cobra"
)

var (
	checkpointPutMissionID string
	checkpointPutData      string
)

var checkpointPutCmd = &cobra.Command{
	Use:          "put",
	Short:        "Upsert the checkpoint document for a mission",
	Long: `Parses --data as JSON and POSTs it to
/api/controller-checkpoint/<missionId>. Prints the persisted
(echoed-back) document to stdout.

Exits non-zero before making any HTTP call when --data is not valid JSON.
Used for seeding initial state and debugging; the tick command owns the
checkpoint in production.`,
	SilenceUsage: true,
	Args:         cobra.NoArgs,
	RunE: func(cmd *cobra.Command, args []string) error {
		baseURL, _ := cmd.Root().PersistentFlags().GetString("base-url")

		missionID := checkpointPutMissionID
		if missionID == "" {
			missionID = os.Getenv("ATEAM_MISSION_ID")
		}

		// Validate JSON before touching the network — fail fast on client side.
		var doc json.RawMessage
		if err := json.Unmarshal([]byte(checkpointPutData), &doc); err != nil {
			return fmt.Errorf("parse --data: invalid JSON: %w", err)
		}

		cli := client.NewClient(baseURL, "")
		body, err := cli.Do(http.MethodPost, "/api/controller-checkpoint/"+missionID, nil, nil, doc)
		if err != nil {
			return fmt.Errorf("POST checkpoint: %w", err)
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
	checkpointCmd.AddCommand(checkpointPutCmd)
	checkpointPutCmd.Flags().StringVar(&checkpointPutMissionID, "mission-id", "",
		"Mission ID to target (overrides $ATEAM_MISSION_ID)")
	checkpointPutCmd.Flags().StringVar(&checkpointPutData, "data", "",
		"Full checkpoint document as a JSON string")
}
