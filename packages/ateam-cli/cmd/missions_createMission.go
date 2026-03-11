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
	missionsCreateMissionCmdBody string
	missionsCreateMissionCmdBodyFile string
	missionsCreateMissionCmd_force bool
	missionsCreateMissionCmd_name string
	missionsCreateMissionCmd_prdPath string
)

var missionsCreateMissionCmd = &cobra.Command{
	Use: "createMission",
	Short: "Create a mission",
	Args: cobra.NoArgs,
	RunE: func(cmd *cobra.Command, args []string) error {
		baseURL, _ := cmd.Root().PersistentFlags().GetString("base-url")
		token := os.Getenv("ATEAM_TOKEN")
		c := client.NewClient(baseURL, token)
		pathParams := map[string]string{}
		queryParams := map[string]string{}
		if missionsCreateMissionCmdBodyFile != "" {
			fileData, err := os.ReadFile(missionsCreateMissionCmdBodyFile)
			if err != nil {
				return fmt.Errorf("reading body-file: %w", err)
			}
			if !json.Valid(fileData) {
				return fmt.Errorf("body-file does not contain valid JSON")
			}
			missionsCreateMissionCmdBody = string(fileData)
		}
		if missionsCreateMissionCmdBody != "" {
			if !json.Valid([]byte(missionsCreateMissionCmdBody)) {
				return fmt.Errorf("--body does not contain valid JSON")
			}
			var bodyObj interface{}
			_ = json.Unmarshal([]byte(missionsCreateMissionCmdBody), &bodyObj)
			resp, err := c.Do("POST", "/api/missions", pathParams, queryParams, bodyObj)
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
		bodyMap["force"] = missionsCreateMissionCmd_force
		bodyMap["name"] = missionsCreateMissionCmd_name
		bodyMap["prdPath"] = missionsCreateMissionCmd_prdPath
		resp, err := c.Do("POST", "/api/missions", pathParams, queryParams, bodyMap)
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
	missionsCmd.AddCommand(missionsCreateMissionCmd)
	missionsCreateMissionCmd.Flags().StringVar(&missionsCreateMissionCmdBody, "body", "", "Raw JSON body (overrides individual flags)")
	missionsCreateMissionCmd.Flags().StringVar(&missionsCreateMissionCmdBodyFile, "body-file", "", "Path to JSON file to use as request body")
	missionsCreateMissionCmd.Flags().BoolVar(&missionsCreateMissionCmd_force, "force", false, "")
	missionsCreateMissionCmd.Flags().StringVar(&missionsCreateMissionCmd_name, "name", "", "")
	missionsCreateMissionCmd.Flags().StringVar(&missionsCreateMissionCmd_prdPath, "prdPath", "", "")
	missionsCreateMissionCmd.MarkFlagRequired("name")
	missionsCreateMissionCmd.MarkFlagRequired("prdPath")
}
