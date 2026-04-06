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
	missionsPrecheckMissionPrecheckCmdBody string
	missionsPrecheckMissionPrecheckCmdBodyFile string
	missionsPrecheckMissionPrecheckCmd_blockers []string
	missionsPrecheckMissionPrecheckCmd_output string
	missionsPrecheckMissionPrecheckCmd_passed bool
)

var missionsPrecheckMissionPrecheckCmd = &cobra.Command{
	Use: "missionPrecheck",
	Short: "Record precheck result",
	Args: cobra.NoArgs,
	RunE: func(cmd *cobra.Command, args []string) error {
		baseURL, _ := cmd.Root().PersistentFlags().GetString("base-url")
		token := os.Getenv("ATEAM_TOKEN")
		c := client.NewClient(baseURL, token)
		pathParams := map[string]string{}
		queryParams := map[string]string{}
		if missionsPrecheckMissionPrecheckCmdBodyFile != "" {
			fileData, err := os.ReadFile(missionsPrecheckMissionPrecheckCmdBodyFile)
			if err != nil {
				return fmt.Errorf("reading body-file: %w", err)
			}
			if !json.Valid(fileData) {
				return fmt.Errorf("body-file does not contain valid JSON")
			}
			missionsPrecheckMissionPrecheckCmdBody = string(fileData)
		}
		if missionsPrecheckMissionPrecheckCmdBody != "" {
			if !json.Valid([]byte(missionsPrecheckMissionPrecheckCmdBody)) {
				return fmt.Errorf("--body does not contain valid JSON")
			}
			var bodyObj interface{}
			_ = json.Unmarshal([]byte(missionsPrecheckMissionPrecheckCmdBody), &bodyObj)
			resp, err := c.Do("POST", "/api/missions/precheck", pathParams, queryParams, bodyObj)
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
		bodyMap := map[string]interface{}{}
		bodyMap["passed"] = missionsPrecheckMissionPrecheckCmd_passed
		if cmd.Flags().Changed("blockers") {
			bodyMap["blockers"] = missionsPrecheckMissionPrecheckCmd_blockers
		}
		if cmd.Flags().Changed("output") {
			var outputObj interface{}
			if err := json.Unmarshal([]byte(missionsPrecheckMissionPrecheckCmd_output), &outputObj); err != nil {
				return fmt.Errorf("--output must be valid JSON: %w", err)
			}
			bodyMap["output"] = outputObj
		}
		resp, err := c.Do("POST", "/api/missions/precheck", pathParams, queryParams, bodyMap)
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
	missionsPrecheckCmd.AddCommand(missionsPrecheckMissionPrecheckCmd)
	missionsPrecheckMissionPrecheckCmd.Flags().StringVar(&missionsPrecheckMissionPrecheckCmdBody, "body", "", "Raw JSON body (overrides individual flags)")
	missionsPrecheckMissionPrecheckCmd.Flags().StringVar(&missionsPrecheckMissionPrecheckCmdBodyFile, "body-file", "", "Path to JSON file to use as request body")
	missionsPrecheckMissionPrecheckCmd.Flags().StringArrayVar(&missionsPrecheckMissionPrecheckCmd_blockers, "blockers", nil, "")
	missionsPrecheckMissionPrecheckCmd.Flags().StringVar(&missionsPrecheckMissionPrecheckCmd_output, "output", "", "")
	missionsPrecheckMissionPrecheckCmd.Flags().BoolVar(&missionsPrecheckMissionPrecheckCmd_passed, "passed", false, "")
	missionsPrecheckMissionPrecheckCmd.MarkFlagRequired("passed")
}
