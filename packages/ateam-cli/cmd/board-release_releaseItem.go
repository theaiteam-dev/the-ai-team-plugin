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
	boardReleaseReleaseItemCmdBody string
	boardReleaseReleaseItemCmdBodyFile string
	boardReleaseReleaseItemCmd_itemId string
)

var boardReleaseReleaseItemCmd = &cobra.Command{
	Use: "releaseItem",
	Short: "Release an agent claim (idempotent)",
	Args: cobra.NoArgs,
	RunE: func(cmd *cobra.Command, args []string) error {
		baseURL, _ := cmd.Root().PersistentFlags().GetString("base-url")
		token := os.Getenv("ATEAM_TOKEN")
		c := client.NewClient(baseURL, token)
		pathParams := map[string]string{}
		queryParams := map[string]string{}
		if boardReleaseReleaseItemCmdBodyFile != "" {
			fileData, err := os.ReadFile(boardReleaseReleaseItemCmdBodyFile)
			if err != nil {
				return fmt.Errorf("reading body-file: %w", err)
			}
			if !json.Valid(fileData) {
				return fmt.Errorf("body-file does not contain valid JSON")
			}
			boardReleaseReleaseItemCmdBody = string(fileData)
		}
		if boardReleaseReleaseItemCmdBody != "" {
			if !json.Valid([]byte(boardReleaseReleaseItemCmdBody)) {
				return fmt.Errorf("--body does not contain valid JSON")
			}
			var bodyObj interface{}
			_ = json.Unmarshal([]byte(boardReleaseReleaseItemCmdBody), &bodyObj)
			resp, err := c.Do("POST", "/api/board/release", pathParams, queryParams, bodyObj)
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
		if err := validate.RequireFlags(cmd, "itemId"); err != nil {
			return err
		}
		bodyMap := map[string]interface{}{}
		bodyMap["itemId"] = boardReleaseReleaseItemCmd_itemId
		resp, err := c.Do("POST", "/api/board/release", pathParams, queryParams, bodyMap)
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
	boardReleaseCmd.AddCommand(boardReleaseReleaseItemCmd)
	boardReleaseReleaseItemCmd.Flags().StringVar(&boardReleaseReleaseItemCmdBody, "body", "", "Raw JSON body (overrides individual flags)")
	boardReleaseReleaseItemCmd.Flags().StringVar(&boardReleaseReleaseItemCmdBodyFile, "body-file", "", "Path to JSON file to use as request body")
	boardReleaseReleaseItemCmd.Flags().StringVar(&boardReleaseReleaseItemCmd_itemId, "itemId", "", "")
	// NOTE: required-flag enforcement is done in RunE via validate.RequireFlags
	// so that --body / --body-file can be used as an alternative to individual
	// flags. Cobra's MarkFlagRequired runs before RunE and cannot be bypassed.
}
