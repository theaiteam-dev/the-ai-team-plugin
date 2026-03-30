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
	agentsStopAgentStopCmdBody string
	agentsStopAgentStopCmdBodyFile string
	agentsStopAgentStopCmd_agent string
	agentsStopAgentStopCmd_advance bool
	agentsStopAgentStopCmd_itemId string
	agentsStopAgentStopCmd_outcome string
	agentsStopAgentStopCmd_summary string
)

var agentsStopAgentStopCmd = &cobra.Command{
	Use: "agentStop",
	Short: "Agent completes work on an item",
	Args: cobra.NoArgs,
	RunE: func(cmd *cobra.Command, args []string) error {
		baseURL, _ := cmd.Root().PersistentFlags().GetString("base-url")
		token := os.Getenv("ATEAM_TOKEN")
		c := client.NewClient(baseURL, token)
		pathParams := map[string]string{}
		queryParams := map[string]string{}
		if err := validate.Enum("agent", agentsStopAgentStopCmd_agent, []string{"Hannibal", "Face", "Murdock", "B.A.", "Amy", "Lynch", "Stockwell", "Sosa", "Tawnia"}); err != nil { return err }
		if cmd.Flags().Changed("outcome") { if err := validate.Enum("outcome", agentsStopAgentStopCmd_outcome, []string{"completed", "blocked"}); err != nil { return err } }
		if agentsStopAgentStopCmdBodyFile != "" {
			fileData, err := os.ReadFile(agentsStopAgentStopCmdBodyFile)
			if err != nil {
				return fmt.Errorf("reading body-file: %w", err)
			}
			if !json.Valid(fileData) {
				return fmt.Errorf("body-file does not contain valid JSON")
			}
			agentsStopAgentStopCmdBody = string(fileData)
		}
		if agentsStopAgentStopCmdBody != "" {
			if !json.Valid([]byte(agentsStopAgentStopCmdBody)) {
				return fmt.Errorf("--body does not contain valid JSON")
			}
			var bodyObj interface{}
			_ = json.Unmarshal([]byte(agentsStopAgentStopCmdBody), &bodyObj)
			resp, err := c.Do("POST", "/api/agents/stop", pathParams, queryParams, bodyObj)
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
		bodyMap["agent"] = agentsStopAgentStopCmd_agent
		bodyMap["advance"] = agentsStopAgentStopCmd_advance
		bodyMap["itemId"] = agentsStopAgentStopCmd_itemId
		bodyMap["outcome"] = agentsStopAgentStopCmd_outcome
		bodyMap["summary"] = agentsStopAgentStopCmd_summary
		resp, err := c.Do("POST", "/api/agents/stop", pathParams, queryParams, bodyMap)
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
		// Surface WIP limit warning so agents know the item didn't advance
		var parsed struct {
			Data struct {
				WipExceeded  bool   `json:"wipExceeded"`
				BlockedStage string `json:"blockedStage"`
				NextStage    string `json:"nextStage"`
			} `json:"data"`
		}
		if json.Unmarshal(resp, &parsed) == nil && parsed.Data.WipExceeded {
			fmt.Fprintf(os.Stderr, "\nWARNING: WIP limit exceeded on '%s' stage. Work logged and claim released, but item remains in '%s'. It will advance when capacity opens.\n", parsed.Data.BlockedStage, parsed.Data.NextStage)
		}
		return nil
	},
}

func init() {
	agentsStopCmd.AddCommand(agentsStopAgentStopCmd)
	agentsStopAgentStopCmd.Flags().StringVar(&agentsStopAgentStopCmdBody, "body", "", "Raw JSON body (overrides individual flags)")
	agentsStopAgentStopCmd.Flags().StringVar(&agentsStopAgentStopCmdBodyFile, "body-file", "", "Path to JSON file to use as request body")
	agentsStopAgentStopCmd.Flags().StringVar(&agentsStopAgentStopCmd_agent, "agent", "", "(Hannibal|Face|Murdock|B.A.|Amy|Lynch|Stockwell|Sosa|Tawnia)")
	agentsStopAgentStopCmd.Flags().BoolVar(&agentsStopAgentStopCmd_advance, "advance", true, "When true (default), advance item to next stage with WIP limit check. When false, skip stage transition — only release claim and log work.")
	agentsStopAgentStopCmd.RegisterFlagCompletionFunc("agent", func(cmd *cobra.Command, args []string, toComplete string) ([]string, cobra.ShellCompDirective) {
		return []string{"Hannibal", "Face", "Murdock", "B.A.", "Amy", "Lynch", "Stockwell", "Sosa", "Tawnia"}, cobra.ShellCompDirectiveNoFileComp
	})
	agentsStopAgentStopCmd.Flags().StringVar(&agentsStopAgentStopCmd_itemId, "itemId", "", "")
	agentsStopAgentStopCmd.Flags().StringVar(&agentsStopAgentStopCmd_outcome, "outcome", "", "(completed|blocked)")
	agentsStopAgentStopCmd.RegisterFlagCompletionFunc("outcome", func(cmd *cobra.Command, args []string, toComplete string) ([]string, cobra.ShellCompDirective) {
		return []string{"completed", "blocked"}, cobra.ShellCompDirectiveNoFileComp
	})
	agentsStopAgentStopCmd.Flags().StringVar(&agentsStopAgentStopCmd_summary, "summary", "", "")
	agentsStopAgentStopCmd.MarkFlagRequired("agent")
	agentsStopAgentStopCmd.MarkFlagRequired("itemId")
	agentsStopAgentStopCmd.MarkFlagRequired("summary")
}
