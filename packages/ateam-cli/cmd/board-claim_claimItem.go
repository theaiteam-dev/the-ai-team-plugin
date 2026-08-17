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
	boardClaimClaimItemCmdBody string
	boardClaimClaimItemCmdBodyFile string
	boardClaimClaimItemCmd_agent string
	boardClaimClaimItemCmd_itemId string
)

var boardClaimClaimItemCmd = &cobra.Command{
	Use: "claimItem",
	Short: "Agent claims a work item",
	Args: cobra.NoArgs,
	RunE: func(cmd *cobra.Command, args []string) error {
		baseURL, _ := cmd.Root().PersistentFlags().GetString("base-url")
		token := os.Getenv("ATEAM_TOKEN")
		c := client.NewClient(baseURL, token)
		pathParams := map[string]string{}
		queryParams := map[string]string{}
		if boardClaimClaimItemCmdBodyFile != "" {
			fileData, err := os.ReadFile(boardClaimClaimItemCmdBodyFile)
			if err != nil {
				return fmt.Errorf("reading body-file: %w", err)
			}
			if !json.Valid(fileData) {
				return fmt.Errorf("body-file does not contain valid JSON")
			}
			boardClaimClaimItemCmdBody = string(fileData)
		}
		if boardClaimClaimItemCmdBody != "" {
			if !json.Valid([]byte(boardClaimClaimItemCmdBody)) {
				return fmt.Errorf("--body does not contain valid JSON")
			}
			var bodyFields map[string]interface{}
			if err := json.Unmarshal([]byte(boardClaimClaimItemCmdBody), &bodyFields); err != nil {
				return fmt.Errorf("--body must be a JSON object: %w", err)
			}
			agentVal, ok := bodyFields["agent"].(string)
			if !ok || agentVal == "" {
				return fmt.Errorf("--body must include a string \"agent\" field")
			}
			// Same allowed-agent validation as the flag path below (Frankie and
			// Sosa deliberately excluded — see the boundary comment there). The
			// raw-body branch must never reach c.Do with an agent outside this
			// list; do not widen without widening the flag path's enum too.
			if err := validate.Enum("agent", agentVal, []string{"Hannibal", "Face", "Murdock", "B.A.", "Amy", "Lynch", "Stockwell", "Tawnia"}); err != nil {
				return err
			}
			// Send the original bytes unmodified (json.RawMessage's MarshalJSON
			// returns itself) rather than re-marshaling bodyFields, so a valid
			// body reaches the server byte-identical to what the caller passed.
			resp, err := c.Do("POST", "/api/board/claim", pathParams, queryParams, json.RawMessage(boardClaimClaimItemCmdBody))
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
		if err := validate.RequireFlags(cmd, "agent", "itemId"); err != nil {
			return err
		}
		// Deliberately narrower than the openapi.yaml AgentName enum: Frankie
		// never claims or moves board items — `done` is terminal (ADR 0005) —
		// and Sosa is a planning-phase critic who never claims items either.
		// Do not re-add them here on regeneration.
		if err := validate.Enum("agent", boardClaimClaimItemCmd_agent, []string{"Hannibal", "Face", "Murdock", "B.A.", "Amy", "Lynch", "Stockwell", "Tawnia"}); err != nil { return err }
		bodyMap := map[string]interface{}{}
		bodyMap["agent"] = boardClaimClaimItemCmd_agent
		bodyMap["itemId"] = boardClaimClaimItemCmd_itemId
		resp, err := c.Do("POST", "/api/board/claim", pathParams, queryParams, bodyMap)
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
	boardClaimCmd.AddCommand(boardClaimClaimItemCmd)
	boardClaimClaimItemCmd.Flags().StringVar(&boardClaimClaimItemCmdBody, "body", "", "Raw JSON body (overrides individual flags)")
	boardClaimClaimItemCmd.Flags().StringVar(&boardClaimClaimItemCmdBodyFile, "body-file", "", "Path to JSON file to use as request body")
	// Help text and completion mirror the validate.Enum list in RunE — no
	// Sosa or Frankie (see the comment there before widening either).
	boardClaimClaimItemCmd.Flags().StringVar(&boardClaimClaimItemCmd_agent, "agent", "", "(Hannibal|Face|Murdock|B.A.|Amy|Lynch|Stockwell|Tawnia)")
	boardClaimClaimItemCmd.RegisterFlagCompletionFunc("agent", func(cmd *cobra.Command, args []string, toComplete string) ([]string, cobra.ShellCompDirective) {
		return []string{"Hannibal", "Face", "Murdock", "B.A.", "Amy", "Lynch", "Stockwell", "Tawnia"}, cobra.ShellCompDirectiveNoFileComp
	})
	boardClaimClaimItemCmd.Flags().StringVar(&boardClaimClaimItemCmd_itemId, "itemId", "", "")
	// NOTE: required-flag enforcement is done in RunE via validate.RequireFlags
	// so that --body / --body-file can be used as an alternative to individual
	// flags. Cobra's MarkFlagRequired runs before RunE and cannot be bypassed.
}
