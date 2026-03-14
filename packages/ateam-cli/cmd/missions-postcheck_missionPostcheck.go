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
	missionsPostcheckMissionPostcheckCmdBody string
	missionsPostcheckMissionPostcheckCmdBodyFile string
)

var missionsPostcheckMissionPostcheckCmd = &cobra.Command{
	Use: "missionPostcheck",
	Short: "Run post-mission checks",
	Args: cobra.NoArgs,
	RunE: func(cmd *cobra.Command, args []string) error {
		baseURL, _ := cmd.Root().PersistentFlags().GetString("base-url")
		token := os.Getenv("ATEAM_TOKEN")
		c := client.NewClient(baseURL, token)
		pathParams := map[string]string{}
		queryParams := map[string]string{}
		if missionsPostcheckMissionPostcheckCmdBodyFile != "" {
			fileData, err := os.ReadFile(missionsPostcheckMissionPostcheckCmdBodyFile)
			if err != nil {
				return fmt.Errorf("reading body-file: %w", err)
			}
			if !json.Valid(fileData) {
				return fmt.Errorf("body-file does not contain valid JSON")
			}
			missionsPostcheckMissionPostcheckCmdBody = string(fileData)
		}
		if missionsPostcheckMissionPostcheckCmdBody != "" {
			if !json.Valid([]byte(missionsPostcheckMissionPostcheckCmdBody)) {
				return fmt.Errorf("--body does not contain valid JSON")
			}
			var bodyObj interface{}
			_ = json.Unmarshal([]byte(missionsPostcheckMissionPostcheckCmdBody), &bodyObj)
			resp, err := c.Do("POST", "/api/missions/postcheck", pathParams, queryParams, bodyObj)
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
		resp, err := c.Do("POST", "/api/missions/postcheck", pathParams, queryParams, nil)
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
	missionsPostcheckCmd.AddCommand(missionsPostcheckMissionPostcheckCmd)
	missionsPostcheckMissionPostcheckCmd.Flags().StringVar(&missionsPostcheckMissionPostcheckCmdBody, "body", "", "Raw JSON body (overrides individual flags)")
	missionsPostcheckMissionPostcheckCmd.Flags().StringVar(&missionsPostcheckMissionPostcheckCmdBodyFile, "body-file", "", "Path to JSON file to use as request body")
}
