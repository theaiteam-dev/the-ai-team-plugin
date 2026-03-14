package cmd

import (
	"fmt"
	"os"
	"strconv"
	"github.com/spf13/cobra"
	"ateam/internal/client"
	"ateam/internal/output"
)

var (
	activityListActivityCmd_limit int
	activityListActivityCmd_missionId string
)

var activityListActivityCmd = &cobra.Command{
	Use: "listActivity",
	Short: "Get activity log entries",
	Args: cobra.NoArgs,
	RunE: func(cmd *cobra.Command, args []string) error {
		baseURL, _ := cmd.Root().PersistentFlags().GetString("base-url")
		token := os.Getenv("ATEAM_TOKEN")
		c := client.NewClient(baseURL, token)
		pathParams := map[string]string{}
		queryParams := map[string]string{}
		queryParams["limit"] = strconv.Itoa(activityListActivityCmd_limit)
		queryParams["missionId"] = activityListActivityCmd_missionId
		resp, err := c.Do("GET", "/api/activity", pathParams, queryParams, nil)
		if err != nil {
			return err
		}
		jsonMode, _ := cmd.Root().PersistentFlags().GetBool("json")
		noColor, _ := cmd.Root().PersistentFlags().GetBool("no-color")
		if jsonMode {
			fmt.Printf("%s\n", string(resp))
		} else {
			if err := output.PrintTable(resp, noColor); err != nil {
				fmt.Println(string(resp))
			}
		}
		return nil
	},
}

func init() {
	activityCmd.AddCommand(activityListActivityCmd)
	activityListActivityCmd.Flags().IntVar(&activityListActivityCmd_limit, "limit", 0, "")
	activityListActivityCmd.Flags().StringVar(&activityListActivityCmd_missionId, "missionId", "", "Filter to a specific mission (defaults to current mission)")
}
