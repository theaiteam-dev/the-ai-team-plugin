package cmd

import (
	"encoding/json"
	"fmt"
	"os"
	"github.com/spf13/cobra"
	"ateam/internal/client"
	"ateam/internal/output"
)

var (
	missionsAggregateTokenUsageCmdBody string
	missionsAggregateTokenUsageCmdBodyFile string
)

var missionsAggregateTokenUsageCmd = &cobra.Command{
	Use: "aggregateTokenUsage",
	Short: "Aggregate token usage from hook events",
	Args: cobra.NoArgs,
	RunE: func(cmd *cobra.Command, args []string) error {
		baseURL, _ := cmd.Root().PersistentFlags().GetString("base-url")
		token := os.Getenv("ATEAM_TOKEN")
		c := client.NewClient(baseURL, token)
		pathParams := map[string]string{}
		queryParams := map[string]string{}
		if missionsAggregateTokenUsageCmdBodyFile != "" {
			fileData, err := os.ReadFile(missionsAggregateTokenUsageCmdBodyFile)
			if err != nil {
				return fmt.Errorf("reading body-file: %w", err)
			}
			if !json.Valid(fileData) {
				return fmt.Errorf("body-file does not contain valid JSON")
			}
			missionsAggregateTokenUsageCmdBody = string(fileData)
		}
		if missionsAggregateTokenUsageCmdBody != "" {
			if !json.Valid([]byte(missionsAggregateTokenUsageCmdBody)) {
				return fmt.Errorf("--body does not contain valid JSON")
			}
			var bodyObj interface{}
			_ = json.Unmarshal([]byte(missionsAggregateTokenUsageCmdBody), &bodyObj)
			resp, err := c.Do("POST", "/api/missions/{missionId}/token-usage", pathParams, queryParams, bodyObj)
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
		}
		resp, err := c.Do("POST", "/api/missions/{missionId}/token-usage", pathParams, queryParams, nil)
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
	missionsCmd.AddCommand(missionsAggregateTokenUsageCmd)
	missionsAggregateTokenUsageCmd.Flags().StringVar(&missionsAggregateTokenUsageCmdBody, "body", "", "Raw JSON body (overrides individual flags)")
	missionsAggregateTokenUsageCmd.Flags().StringVar(&missionsAggregateTokenUsageCmdBodyFile, "body-file", "", "Path to JSON file to use as request body")
}
