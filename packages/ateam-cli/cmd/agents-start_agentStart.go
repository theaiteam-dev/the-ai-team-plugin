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
	agentsStartAgentStartCmdBody string
	agentsStartAgentStartCmdBodyFile string
	agentsStartAgentStartCmd_agent string
	agentsStartAgentStartCmd_itemId string
)

var agentsStartAgentStartCmd = &cobra.Command{
	Use: "agentStart",
	Short: "Agent begins work on an item",
	Args: cobra.NoArgs,
	RunE: func(cmd *cobra.Command, args []string) error {
		baseURL, _ := cmd.Root().PersistentFlags().GetString("base-url")
		token := os.Getenv("ATEAM_TOKEN")
		c := client.NewClient(baseURL, token)
		pathParams := map[string]string{}
		queryParams := map[string]string{}
		if err := validate.Enum("agent", agentsStartAgentStartCmd_agent, []string{"Hannibal", "Face", "Murdock", "B.A.", "Amy", "Lynch", "Lynch-Final", "Sosa", "Tawnia"}); err != nil { return err }
		if agentsStartAgentStartCmdBodyFile != "" {
			fileData, err := os.ReadFile(agentsStartAgentStartCmdBodyFile)
			if err != nil {
				return fmt.Errorf("reading body-file: %w", err)
			}
			if !json.Valid(fileData) {
				return fmt.Errorf("body-file does not contain valid JSON")
			}
			agentsStartAgentStartCmdBody = string(fileData)
		}
		if agentsStartAgentStartCmdBody != "" {
			if !json.Valid([]byte(agentsStartAgentStartCmdBody)) {
				return fmt.Errorf("--body does not contain valid JSON")
			}
			var bodyObj interface{}
			_ = json.Unmarshal([]byte(agentsStartAgentStartCmdBody), &bodyObj)
			resp, err := c.Do("POST", "/api/agents/start", pathParams, queryParams, bodyObj)
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
		bodyMap["agent"] = agentsStartAgentStartCmd_agent
		bodyMap["itemId"] = agentsStartAgentStartCmd_itemId
		resp, err := c.Do("POST", "/api/agents/start", pathParams, queryParams, bodyMap)
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
	agentsStartCmd.AddCommand(agentsStartAgentStartCmd)
	agentsStartAgentStartCmd.Flags().StringVar(&agentsStartAgentStartCmdBody, "body", "", "Raw JSON body (overrides individual flags)")
	agentsStartAgentStartCmd.Flags().StringVar(&agentsStartAgentStartCmdBodyFile, "body-file", "", "Path to JSON file to use as request body")
	agentsStartAgentStartCmd.Flags().StringVar(&agentsStartAgentStartCmd_agent, "agent", "", "(Hannibal|Face|Murdock|B.A.|Amy|Lynch|Lynch-Final|Sosa|Tawnia)")
	agentsStartAgentStartCmd.RegisterFlagCompletionFunc("agent", func(cmd *cobra.Command, args []string, toComplete string) ([]string, cobra.ShellCompDirective) {
		return []string{"Hannibal", "Face", "Murdock", "B.A.", "Amy", "Lynch", "Lynch-Final", "Sosa", "Tawnia"}, cobra.ShellCompDirectiveNoFileComp
	})
	agentsStartAgentStartCmd.Flags().StringVar(&agentsStartAgentStartCmd_itemId, "itemId", "", "")
	agentsStartAgentStartCmd.MarkFlagRequired("agent")
	agentsStartAgentStartCmd.MarkFlagRequired("itemId")
}
