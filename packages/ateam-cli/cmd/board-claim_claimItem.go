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
		if err := validate.Enum("agent", boardClaimClaimItemCmd_agent, []string{"Hannibal", "Face", "Murdock", "B.A.", "Amy", "Lynch", "Stockwell", "Sosa", "Tawnia"}); err != nil { return err }
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
			var bodyObj interface{}
			_ = json.Unmarshal([]byte(boardClaimClaimItemCmdBody), &bodyObj)
			resp, err := c.Do("POST", "/api/board/claim", pathParams, queryParams, bodyObj)
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
	boardClaimClaimItemCmd.Flags().StringVar(&boardClaimClaimItemCmd_agent, "agent", "", "(Hannibal|Face|Murdock|B.A.|Amy|Lynch|Stockwell|Sosa|Tawnia)")
	boardClaimClaimItemCmd.RegisterFlagCompletionFunc("agent", func(cmd *cobra.Command, args []string, toComplete string) ([]string, cobra.ShellCompDirective) {
		return []string{"Hannibal", "Face", "Murdock", "B.A.", "Amy", "Lynch", "Stockwell", "Sosa", "Tawnia"}, cobra.ShellCompDirectiveNoFileComp
	})
	boardClaimClaimItemCmd.Flags().StringVar(&boardClaimClaimItemCmd_itemId, "itemId", "", "")
	boardClaimClaimItemCmd.MarkFlagRequired("agent")
	boardClaimClaimItemCmd.MarkFlagRequired("itemId")
}
