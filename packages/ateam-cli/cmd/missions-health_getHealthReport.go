package cmd

import (
	"fmt"
	"os"
	"github.com/spf13/cobra"
	"ateam/internal/client"
	"ateam/internal/output"
)

var missionsHealthGetHealthReportCmd = &cobra.Command{
	Use: "getHealthReport",
	Short: "Get the health report for the active mission",
	Args: cobra.NoArgs,
	RunE: func(cmd *cobra.Command, args []string) error {
		baseURL, _ := cmd.Root().PersistentFlags().GetString("base-url")
		token := os.Getenv("ATEAM_TOKEN")
		c := client.NewClient(baseURL, token)
		pathParams := map[string]string{}
		queryParams := map[string]string{}
		resp, err := c.Do("GET", "/api/missions/current/health-report", pathParams, queryParams, nil)
		if err != nil {
			return err
		}
		jsonMode, _ := cmd.Root().PersistentFlags().GetBool("json")
		noColor, _ := cmd.Root().PersistentFlags().GetBool("no-color")
		if jsonMode {
			fmt.Fprintf(cmd.OutOrStdout(), "%s\n", string(resp))
		} else {
			if err := output.PrintTable(resp, noColor); err != nil {
				fmt.Fprintln(cmd.OutOrStdout(), string(resp))
			}
		}
		return nil
	},
}

func init() {
	missionsHealthCmd.AddCommand(missionsHealthGetHealthReportCmd)
}
