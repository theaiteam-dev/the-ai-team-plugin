package cmd

import (
	"encoding/json"
	"fmt"
	"os"
	"github.com/spf13/cobra"
	"ateam/internal/client"
	"ateam/internal/output"
	"ateam/internal/validate"
)

var (
	activityCreateActivityEntryCmdBody string
	activityCreateActivityEntryCmdBodyFile string
	activityCreateActivityEntryCmd_agent string
	activityCreateActivityEntryCmd_level string
	activityCreateActivityEntryCmd_message string
)

var activityCreateActivityEntryCmd = &cobra.Command{
	Use: "createActivityEntry",
	Short: "Append an activity log entry",
	Args: cobra.NoArgs,
	RunE: func(cmd *cobra.Command, args []string) error {
		baseURL, _ := cmd.Root().PersistentFlags().GetString("base-url")
		token := os.Getenv("ATEAM_TOKEN")
		c := client.NewClient(baseURL, token)
		pathParams := map[string]string{}
		queryParams := map[string]string{}
		if cmd.Flags().Changed("level") { if err := validate.Enum("level", activityCreateActivityEntryCmd_level, []string{"info", "warn", "error"}); err != nil { return err } }
		if activityCreateActivityEntryCmdBodyFile != "" {
			fileData, err := os.ReadFile(activityCreateActivityEntryCmdBodyFile)
			if err != nil {
				return fmt.Errorf("reading body-file: %w", err)
			}
			if !json.Valid(fileData) {
				return fmt.Errorf("body-file does not contain valid JSON")
			}
			activityCreateActivityEntryCmdBody = string(fileData)
		}
		if activityCreateActivityEntryCmdBody != "" {
			if !json.Valid([]byte(activityCreateActivityEntryCmdBody)) {
				return fmt.Errorf("--body does not contain valid JSON")
			}
			var bodyObj interface{}
			_ = json.Unmarshal([]byte(activityCreateActivityEntryCmdBody), &bodyObj)
			resp, err := c.Do("POST", "/api/activity", pathParams, queryParams, bodyObj)
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
		if err := validate.RequireFlags(cmd, "message"); err != nil {
			return err
		}
		bodyMap := map[string]interface{}{}
		bodyMap["agent"] = activityCreateActivityEntryCmd_agent
		bodyMap["level"] = activityCreateActivityEntryCmd_level
		bodyMap["message"] = activityCreateActivityEntryCmd_message
		resp, err := c.Do("POST", "/api/activity", pathParams, queryParams, bodyMap)
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
	activityCmd.AddCommand(activityCreateActivityEntryCmd)
	activityCreateActivityEntryCmd.Flags().StringVar(&activityCreateActivityEntryCmdBody, "body", "", "Raw JSON body (overrides individual flags)")
	activityCreateActivityEntryCmd.Flags().StringVar(&activityCreateActivityEntryCmdBodyFile, "body-file", "", "Path to JSON file to use as request body")
	activityCreateActivityEntryCmd.Flags().StringVar(&activityCreateActivityEntryCmd_agent, "agent", "", "")
	activityCreateActivityEntryCmd.Flags().StringVar(&activityCreateActivityEntryCmd_level, "level", "", "(info|warn|error)")
	activityCreateActivityEntryCmd.RegisterFlagCompletionFunc("level", func(cmd *cobra.Command, args []string, toComplete string) ([]string, cobra.ShellCompDirective) {
		return []string{"info", "warn", "error"}, cobra.ShellCompDirectiveNoFileComp
	})
	activityCreateActivityEntryCmd.Flags().StringVar(&activityCreateActivityEntryCmd_message, "message", "", "")
	// NOTE: required-flag enforcement is done in RunE via validate.RequireFlags
	// so that --body / --body-file can be used as an alternative to individual
	// flags. Cobra's MarkFlagRequired runs before RunE and cannot be bypassed.
}
