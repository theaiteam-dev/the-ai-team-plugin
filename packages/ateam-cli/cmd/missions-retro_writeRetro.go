package cmd

import (
	"fmt"
	"os"

	"ateam/internal/client"
	"ateam/internal/output"

	"github.com/spf13/cobra"
)

var (
	missionsRetroWriteRetroCmdMissionId string
	missionsRetroWriteRetroCmdReport    string
)

var missionsRetroWriteRetroCmd = &cobra.Command{
	Use:   "writeRetro",
	Short: "Store a retrospective report on a mission",
	Args:  cobra.NoArgs,
	RunE: func(cmd *cobra.Command, args []string) error {
		baseURL, _ := cmd.Root().PersistentFlags().GetString("base-url")
		token := os.Getenv("ATEAM_TOKEN")
		c := client.NewClient(baseURL, token)
		pathParams := map[string]string{
			"missionId": missionsRetroWriteRetroCmdMissionId,
		}
		queryParams := map[string]string{}
		bodyMap := map[string]interface{}{
			"retroReport": missionsRetroWriteRetroCmdReport,
		}
		resp, err := c.Do("POST", "/api/missions/{missionId}/retro", pathParams, queryParams, bodyMap)
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
	missionsRetroCmd.AddCommand(missionsRetroWriteRetroCmd)
	missionsRetroWriteRetroCmd.Flags().StringVar(&missionsRetroWriteRetroCmdMissionId, "missionId", "", "Mission ID")
	missionsRetroWriteRetroCmd.Flags().StringVar(&missionsRetroWriteRetroCmdReport, "report", "", "Retrospective report markdown content")
	missionsRetroWriteRetroCmd.MarkFlagRequired("missionId")
	missionsRetroWriteRetroCmd.MarkFlagRequired("report")
}
