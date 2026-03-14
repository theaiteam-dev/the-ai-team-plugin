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
	boardMoveMoveItemCmdBody string
	boardMoveMoveItemCmdBodyFile string
	boardMoveMoveItemCmd_force bool
	boardMoveMoveItemCmd_itemId string
	boardMoveMoveItemCmd_toStage string
)

var boardMoveMoveItemCmd = &cobra.Command{
	Use: "moveItem",
	Short: "Move item to a new stage",
	Args: cobra.NoArgs,
	RunE: func(cmd *cobra.Command, args []string) error {
		baseURL, _ := cmd.Root().PersistentFlags().GetString("base-url")
		token := os.Getenv("ATEAM_TOKEN")
		c := client.NewClient(baseURL, token)
		pathParams := map[string]string{}
		queryParams := map[string]string{}
		if err := validate.Enum("toStage", boardMoveMoveItemCmd_toStage, []string{"briefings", "ready", "testing", "implementing", "review", "probing", "done", "blocked"}); err != nil { return err }
		if boardMoveMoveItemCmdBodyFile != "" {
			fileData, err := os.ReadFile(boardMoveMoveItemCmdBodyFile)
			if err != nil {
				return fmt.Errorf("reading body-file: %w", err)
			}
			if !json.Valid(fileData) {
				return fmt.Errorf("body-file does not contain valid JSON")
			}
			boardMoveMoveItemCmdBody = string(fileData)
		}
		if boardMoveMoveItemCmdBody != "" {
			if !json.Valid([]byte(boardMoveMoveItemCmdBody)) {
				return fmt.Errorf("--body does not contain valid JSON")
			}
			var bodyObj interface{}
			_ = json.Unmarshal([]byte(boardMoveMoveItemCmdBody), &bodyObj)
			resp, err := c.Do("POST", "/api/board/move", pathParams, queryParams, bodyObj)
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
		bodyMap["force"] = boardMoveMoveItemCmd_force
		bodyMap["itemId"] = boardMoveMoveItemCmd_itemId
		bodyMap["toStage"] = boardMoveMoveItemCmd_toStage
		resp, err := c.Do("POST", "/api/board/move", pathParams, queryParams, bodyMap)
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
	boardMoveCmd.AddCommand(boardMoveMoveItemCmd)
	boardMoveMoveItemCmd.Flags().StringVar(&boardMoveMoveItemCmdBody, "body", "", "Raw JSON body (overrides individual flags)")
	boardMoveMoveItemCmd.Flags().StringVar(&boardMoveMoveItemCmdBodyFile, "body-file", "", "Path to JSON file to use as request body")
	boardMoveMoveItemCmd.Flags().BoolVar(&boardMoveMoveItemCmd_force, "force", false, "")
	boardMoveMoveItemCmd.Flags().StringVar(&boardMoveMoveItemCmd_itemId, "itemId", "", "")
	boardMoveMoveItemCmd.Flags().StringVar(&boardMoveMoveItemCmd_toStage, "toStage", "", "(briefings|ready|testing|implementing|review|probing|done|blocked)")
	boardMoveMoveItemCmd.RegisterFlagCompletionFunc("toStage", func(cmd *cobra.Command, args []string, toComplete string) ([]string, cobra.ShellCompDirective) {
		return []string{"briefings", "ready", "testing", "implementing", "review", "probing", "done", "blocked"}, cobra.ShellCompDirectiveNoFileComp
	})
	boardMoveMoveItemCmd.MarkFlagRequired("itemId")
	boardMoveMoveItemCmd.MarkFlagRequired("toStage")
}
