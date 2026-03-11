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
	missionsArchiveArchiveMissionCmdBody string
	missionsArchiveArchiveMissionCmdBodyFile string
)

var missionsArchiveArchiveMissionCmd = &cobra.Command{
	Use: "archiveMission",
	Short: "Archive the active mission",
	Args: cobra.NoArgs,
	RunE: func(cmd *cobra.Command, args []string) error {
		baseURL, _ := cmd.Root().PersistentFlags().GetString("base-url")
		token := os.Getenv("ATEAM_TOKEN")
		c := client.NewClient(baseURL, token)
		pathParams := map[string]string{}
		queryParams := map[string]string{}
		if missionsArchiveArchiveMissionCmdBodyFile != "" {
			fileData, err := os.ReadFile(missionsArchiveArchiveMissionCmdBodyFile)
			if err != nil {
				return fmt.Errorf("reading body-file: %w", err)
			}
			if !json.Valid(fileData) {
				return fmt.Errorf("body-file does not contain valid JSON")
			}
			missionsArchiveArchiveMissionCmdBody = string(fileData)
		}
		if missionsArchiveArchiveMissionCmdBody != "" {
			if !json.Valid([]byte(missionsArchiveArchiveMissionCmdBody)) {
				return fmt.Errorf("--body does not contain valid JSON")
			}
			var bodyObj interface{}
			_ = json.Unmarshal([]byte(missionsArchiveArchiveMissionCmdBody), &bodyObj)
			resp, err := c.Do("POST", "/api/missions/archive", pathParams, queryParams, bodyObj)
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
		resp, err := c.Do("POST", "/api/missions/archive", pathParams, queryParams, nil)
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
	missionsArchiveCmd.AddCommand(missionsArchiveArchiveMissionCmd)
	missionsArchiveArchiveMissionCmd.Flags().StringVar(&missionsArchiveArchiveMissionCmdBody, "body", "", "Raw JSON body (overrides individual flags)")
	missionsArchiveArchiveMissionCmd.Flags().StringVar(&missionsArchiveArchiveMissionCmdBodyFile, "body-file", "", "Path to JSON file to use as request body")
}
