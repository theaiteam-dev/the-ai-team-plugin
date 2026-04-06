package cmd

import (
	"fmt"
	"os"

	"ateam/internal/client"
	"ateam/internal/output"

	"github.com/spf13/cobra"
)

var (
	missionsFinalReviewWriteFinalReviewCmdMissionId string
	missionsFinalReviewWriteFinalReviewCmdReport    string
)

var missionsFinalReviewWriteFinalReviewCmd = &cobra.Command{
	Use:   "writeFinalReview",
	Short: "Store a final review report on a mission",
	Args:  cobra.NoArgs,
	RunE: func(cmd *cobra.Command, args []string) error {
		baseURL, _ := cmd.Root().PersistentFlags().GetString("base-url")
		token := os.Getenv("ATEAM_TOKEN")
		c := client.NewClient(baseURL, token)
		pathParams := map[string]string{
			"missionId": missionsFinalReviewWriteFinalReviewCmdMissionId,
		}
		queryParams := map[string]string{}
		bodyMap := map[string]interface{}{
			"finalReview": missionsFinalReviewWriteFinalReviewCmdReport,
		}
		resp, err := c.Do("POST", "/api/missions/{missionId}/final-review", pathParams, queryParams, bodyMap)
		if err != nil {
			return err
		}
		jsonMode, _ := cmd.Root().PersistentFlags().GetBool("json")
		noColor, _ := cmd.Root().PersistentFlags().GetBool("no-color")
		if jsonMode {
			fmt.Fprintf(cmd.OutOrStdout(), "%s\n", string(resp))
		} else {
			if err := output.PrintTable(resp, noColor); err != nil {
				fmt.Println(string(resp))
			}
		}
		return nil
	},
}

func init() {
	missionsFinalReviewCmd.AddCommand(missionsFinalReviewWriteFinalReviewCmd)
	missionsFinalReviewWriteFinalReviewCmd.Flags().StringVar(&missionsFinalReviewWriteFinalReviewCmdMissionId, "missionId", "", "Mission ID")
	missionsFinalReviewWriteFinalReviewCmd.Flags().StringVar(&missionsFinalReviewWriteFinalReviewCmdReport, "report", "", "Final review report markdown content")
	missionsFinalReviewWriteFinalReviewCmd.MarkFlagRequired("missionId")
	missionsFinalReviewWriteFinalReviewCmd.MarkFlagRequired("report")
}
