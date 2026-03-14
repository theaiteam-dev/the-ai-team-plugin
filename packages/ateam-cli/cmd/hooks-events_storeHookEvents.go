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
	hooksEventsStoreHookEventsCmdBody string
	hooksEventsStoreHookEventsCmdBodyFile string
)

var hooksEventsStoreHookEventsCmd = &cobra.Command{
	Use: "storeHookEvents",
	Short: "Store observer hook events",
	Args: cobra.NoArgs,
	RunE: func(cmd *cobra.Command, args []string) error {
		baseURL, _ := cmd.Root().PersistentFlags().GetString("base-url")
		token := os.Getenv("ATEAM_TOKEN")
		c := client.NewClient(baseURL, token)
		pathParams := map[string]string{}
		queryParams := map[string]string{}
		if hooksEventsStoreHookEventsCmdBodyFile != "" {
			fileData, err := os.ReadFile(hooksEventsStoreHookEventsCmdBodyFile)
			if err != nil {
				return fmt.Errorf("reading body-file: %w", err)
			}
			if !json.Valid(fileData) {
				return fmt.Errorf("body-file does not contain valid JSON")
			}
			hooksEventsStoreHookEventsCmdBody = string(fileData)
		}
		if hooksEventsStoreHookEventsCmdBody != "" {
			if !json.Valid([]byte(hooksEventsStoreHookEventsCmdBody)) {
				return fmt.Errorf("--body does not contain valid JSON")
			}
			var bodyObj interface{}
			_ = json.Unmarshal([]byte(hooksEventsStoreHookEventsCmdBody), &bodyObj)
			resp, err := c.Do("POST", "/api/hooks/events", pathParams, queryParams, bodyObj)
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
		resp, err := c.Do("POST", "/api/hooks/events", pathParams, queryParams, nil)
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
	hooksEventsCmd.AddCommand(hooksEventsStoreHookEventsCmd)
	hooksEventsStoreHookEventsCmd.Flags().StringVar(&hooksEventsStoreHookEventsCmdBody, "body", "", "Raw JSON body (overrides individual flags)")
	hooksEventsStoreHookEventsCmd.Flags().StringVar(&hooksEventsStoreHookEventsCmdBodyFile, "body-file", "", "Path to JSON file to use as request body")
}
