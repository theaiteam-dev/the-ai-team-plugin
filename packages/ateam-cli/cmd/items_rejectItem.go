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
	itemsRejectItemCmdBody string
	itemsRejectItemCmdBodyFile string
	itemsRejectItemCmd_reason string
	itemsRejectItemCmd_agent string
)

var itemsRejectItemCmd = &cobra.Command{
	Use: "rejectItem <id>",
	Short: "Record a rejection on an item",
	Args: cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		baseURL, _ := cmd.Root().PersistentFlags().GetString("base-url")
		token := os.Getenv("ATEAM_TOKEN")
		c := client.NewClient(baseURL, token)
		pathParams := map[string]string{}
		pathParams["id"] = args[0]
		queryParams := map[string]string{}
		if err := validate.Enum("agent", itemsRejectItemCmd_agent, []string{"Hannibal", "Face", "Murdock", "B.A.", "Amy", "Lynch", "Lynch-Final", "Sosa", "Tawnia"}); err != nil { return err }
		if itemsRejectItemCmdBodyFile != "" {
			fileData, err := os.ReadFile(itemsRejectItemCmdBodyFile)
			if err != nil {
				return fmt.Errorf("reading body-file: %w", err)
			}
			if !json.Valid(fileData) {
				return fmt.Errorf("body-file does not contain valid JSON")
			}
			itemsRejectItemCmdBody = string(fileData)
		}
		if itemsRejectItemCmdBody != "" {
			if !json.Valid([]byte(itemsRejectItemCmdBody)) {
				return fmt.Errorf("--body does not contain valid JSON")
			}
			var bodyObj interface{}
			_ = json.Unmarshal([]byte(itemsRejectItemCmdBody), &bodyObj)
			resp, err := c.Do("POST", "/api/items/{id}/reject", pathParams, queryParams, bodyObj)
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
		bodyMap["reason"] = itemsRejectItemCmd_reason
		bodyMap["agent"] = itemsRejectItemCmd_agent
		resp, err := c.Do("POST", "/api/items/{id}/reject", pathParams, queryParams, bodyMap)
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
	itemsCmd.AddCommand(itemsRejectItemCmd)
	itemsRejectItemCmd.Flags().StringVar(&itemsRejectItemCmdBody, "body", "", "Raw JSON body (overrides individual flags)")
	itemsRejectItemCmd.Flags().StringVar(&itemsRejectItemCmdBodyFile, "body-file", "", "Path to JSON file to use as request body")
	itemsRejectItemCmd.Flags().StringVar(&itemsRejectItemCmd_reason, "reason", "", "")
	itemsRejectItemCmd.Flags().StringVar(&itemsRejectItemCmd_agent, "agent", "", "(Hannibal|Face|Murdock|B.A.|Amy|Lynch|Lynch-Final|Sosa|Tawnia)")
	itemsRejectItemCmd.RegisterFlagCompletionFunc("agent", func(cmd *cobra.Command, args []string, toComplete string) ([]string, cobra.ShellCompDirective) {
		return []string{"Hannibal", "Face", "Murdock", "B.A.", "Amy", "Lynch", "Lynch-Final", "Sosa", "Tawnia"}, cobra.ShellCompDirectiveNoFileComp
	})
	itemsRejectItemCmd.MarkFlagRequired("reason")
	itemsRejectItemCmd.MarkFlagRequired("agent")
}
