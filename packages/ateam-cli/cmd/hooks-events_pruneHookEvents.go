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
	hooksEventsPruneHookEventsCmdBody string
	hooksEventsPruneHookEventsCmdBodyFile string
	hooksEventsPruneHookEventsCmd_olderThan string
)

var hooksEventsPruneHookEventsCmd = &cobra.Command{
	Use: "pruneHookEvents",
	Short: "Delete old hook events",
	Args: cobra.NoArgs,
	RunE: func(cmd *cobra.Command, args []string) error {
		baseURL, _ := cmd.Root().PersistentFlags().GetString("base-url")
		token := os.Getenv("ATEAM_TOKEN")
		c := client.NewClient(baseURL, token)
		pathParams := map[string]string{}
		queryParams := map[string]string{}
		if hooksEventsPruneHookEventsCmdBodyFile != "" {
			fileData, err := os.ReadFile(hooksEventsPruneHookEventsCmdBodyFile)
			if err != nil {
				return fmt.Errorf("reading body-file: %w", err)
			}
			if !json.Valid(fileData) {
				return fmt.Errorf("body-file does not contain valid JSON")
			}
			hooksEventsPruneHookEventsCmdBody = string(fileData)
		}
		if hooksEventsPruneHookEventsCmdBody != "" {
			if !json.Valid([]byte(hooksEventsPruneHookEventsCmdBody)) {
				return fmt.Errorf("--body does not contain valid JSON")
			}
			var bodyObj interface{}
			_ = json.Unmarshal([]byte(hooksEventsPruneHookEventsCmdBody), &bodyObj)
			resp, err := c.Do("POST", "/api/hooks/events/prune", pathParams, queryParams, bodyObj)
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
		if err := validate.RequireFlags(cmd, "olderThan"); err != nil {
			return err
		}
		bodyMap := map[string]interface{}{}
		bodyMap["olderThan"] = hooksEventsPruneHookEventsCmd_olderThan
		resp, err := c.Do("POST", "/api/hooks/events/prune", pathParams, queryParams, bodyMap)
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
	hooksEventsCmd.AddCommand(hooksEventsPruneHookEventsCmd)
	hooksEventsPruneHookEventsCmd.Flags().StringVar(&hooksEventsPruneHookEventsCmdBody, "body", "", "Raw JSON body (overrides individual flags)")
	hooksEventsPruneHookEventsCmd.Flags().StringVar(&hooksEventsPruneHookEventsCmdBodyFile, "body-file", "", "Path to JSON file to use as request body")
	hooksEventsPruneHookEventsCmd.Flags().StringVar(&hooksEventsPruneHookEventsCmd_olderThan, "olderThan", "", "")
	// NOTE: required-flag enforcement is done in RunE via validate.RequireFlags
	// so that --body / --body-file can be used as an alternative to individual
	// flags. Cobra's MarkFlagRequired runs before RunE and cannot be bypassed.
}
