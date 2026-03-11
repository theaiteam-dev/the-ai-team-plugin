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
	stagesUpdateStageCmdBody string
	stagesUpdateStageCmdBodyFile string
	stagesUpdateStageCmd_wipLimit int
)

var stagesUpdateStageCmd = &cobra.Command{
	Use: "updateStage <id>",
	Short: "Update a stage's WIP limit",
	Args: cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		baseURL, _ := cmd.Root().PersistentFlags().GetString("base-url")
		token := os.Getenv("ATEAM_TOKEN")
		c := client.NewClient(baseURL, token)
		pathParams := map[string]string{}
		pathParams["id"] = args[0]
		queryParams := map[string]string{}
		if stagesUpdateStageCmdBodyFile != "" {
			fileData, err := os.ReadFile(stagesUpdateStageCmdBodyFile)
			if err != nil {
				return fmt.Errorf("reading body-file: %w", err)
			}
			if !json.Valid(fileData) {
				return fmt.Errorf("body-file does not contain valid JSON")
			}
			stagesUpdateStageCmdBody = string(fileData)
		}
		if stagesUpdateStageCmdBody != "" {
			if !json.Valid([]byte(stagesUpdateStageCmdBody)) {
				return fmt.Errorf("--body does not contain valid JSON")
			}
			var bodyObj interface{}
			_ = json.Unmarshal([]byte(stagesUpdateStageCmdBody), &bodyObj)
			resp, err := c.Do("PATCH", "/api/stages/{id}", pathParams, queryParams, bodyObj)
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
		bodyMap["wipLimit"] = stagesUpdateStageCmd_wipLimit
		resp, err := c.Do("PATCH", "/api/stages/{id}", pathParams, queryParams, bodyMap)
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
	stagesCmd.AddCommand(stagesUpdateStageCmd)
	stagesUpdateStageCmd.Flags().StringVar(&stagesUpdateStageCmdBody, "body", "", "Raw JSON body (overrides individual flags)")
	stagesUpdateStageCmd.Flags().StringVar(&stagesUpdateStageCmdBodyFile, "body-file", "", "Path to JSON file to use as request body")
	stagesUpdateStageCmd.Flags().IntVar(&stagesUpdateStageCmd_wipLimit, "wipLimit", 0, "")
	stagesUpdateStageCmd.MarkFlagRequired("wipLimit")
}
