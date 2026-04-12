package cmd

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"github.com/spf13/cobra"
	"ateam/internal/client"
	"ateam/internal/output"
	"ateam/internal/validate"
)

var (
	itemsCreateItemCmdBody string
	itemsCreateItemCmdBodyFile string
	itemsCreateItemCmd_acceptance []string
	itemsCreateItemCmd_context string
	itemsCreateItemCmd_dependencies []string
	itemsCreateItemCmd_description string
	itemsCreateItemCmd_objective string
	itemsCreateItemCmd_outputsImpl string
	itemsCreateItemCmd_outputsTest string
	itemsCreateItemCmd_outputsTypes string
	itemsCreateItemCmd_priority string
	itemsCreateItemCmd_title string
	itemsCreateItemCmd_type string
)

var itemsCreateItemCmd = &cobra.Command{
	Use: "createItem",
	Short: "Create a work item",
	Args: cobra.NoArgs,
	RunE: func(cmd *cobra.Command, args []string) error {
		baseURL, _ := cmd.Root().PersistentFlags().GetString("base-url")
		token := os.Getenv("ATEAM_TOKEN")
		c := client.NewClient(baseURL, token)
		pathParams := map[string]string{}
		queryParams := map[string]string{}
		if itemsCreateItemCmdBodyFile != "" {
			fileData, err := os.ReadFile(itemsCreateItemCmdBodyFile)
			if err != nil {
				return fmt.Errorf("reading body-file: %w", err)
			}
			if !json.Valid(fileData) {
				return fmt.Errorf("body-file does not contain valid JSON")
			}
			itemsCreateItemCmdBody = string(fileData)
		}
		if itemsCreateItemCmdBody != "" {
			if !json.Valid([]byte(itemsCreateItemCmdBody)) {
				return fmt.Errorf("--body does not contain valid JSON")
			}
			var bodyObj interface{}
			_ = json.Unmarshal([]byte(itemsCreateItemCmdBody), &bodyObj)
			resp, err := c.Do("POST", "/api/items", pathParams, queryParams, bodyObj)
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
		if err := validate.RequireFlags(cmd, "description", "objective", "acceptance", "context", "priority", "title", "type"); err != nil {
			return err
		}
		if err := validate.Enum("priority", itemsCreateItemCmd_priority, []string{"critical", "high", "medium", "low"}); err != nil { return err }
		if err := validate.Enum("type", itemsCreateItemCmd_type, []string{"feature", "bug", "enhancement", "task"}); err != nil { return err }
		if !cmd.Flags().Changed("outputs.impl") &&
			!cmd.Flags().Changed("outputs.test") &&
			!cmd.Flags().Changed("outputs.types") {
			return fmt.Errorf("at least one outputs.* flag is required (outputs.impl, outputs.test, or outputs.types)")
		}
		bodyMap := map[string]interface{}{}
		if len(itemsCreateItemCmd_acceptance) > 0 {
			bodyMap["acceptance"] = itemsCreateItemCmd_acceptance
		}
		if itemsCreateItemCmd_context != "" {
			bodyMap["context"] = itemsCreateItemCmd_context
		}
		bodyMap["dependencies"] = itemsCreateItemCmd_dependencies
		bodyMap["description"] = itemsCreateItemCmd_description
		if itemsCreateItemCmd_objective != "" {
			bodyMap["objective"] = itemsCreateItemCmd_objective
		}
		if cmd.Flags().Changed("outputs.impl") {
			_parts := strings.Split("outputs.impl", ".")
			_cur := bodyMap
			for _, _p := range _parts[:len(_parts)-1] {
				if _, ok := _cur[_p]; !ok {
					_cur[_p] = map[string]interface{}{}
				}
				_cur = _cur[_p].(map[string]interface{})
			}
			_cur[_parts[len(_parts)-1]] = itemsCreateItemCmd_outputsImpl
		}
		if cmd.Flags().Changed("outputs.test") {
			_parts := strings.Split("outputs.test", ".")
			_cur := bodyMap
			for _, _p := range _parts[:len(_parts)-1] {
				if _, ok := _cur[_p]; !ok {
					_cur[_p] = map[string]interface{}{}
				}
				_cur = _cur[_p].(map[string]interface{})
			}
			_cur[_parts[len(_parts)-1]] = itemsCreateItemCmd_outputsTest
		}
		if cmd.Flags().Changed("outputs.types") {
			_parts := strings.Split("outputs.types", ".")
			_cur := bodyMap
			for _, _p := range _parts[:len(_parts)-1] {
				if _, ok := _cur[_p]; !ok {
					_cur[_p] = map[string]interface{}{}
				}
				_cur = _cur[_p].(map[string]interface{})
			}
			_cur[_parts[len(_parts)-1]] = itemsCreateItemCmd_outputsTypes
		}
		bodyMap["priority"] = itemsCreateItemCmd_priority
		bodyMap["title"] = itemsCreateItemCmd_title
		bodyMap["type"] = itemsCreateItemCmd_type
		resp, err := c.Do("POST", "/api/items", pathParams, queryParams, bodyMap)
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
	itemsCmd.AddCommand(itemsCreateItemCmd)
	itemsCreateItemCmd.Flags().StringVar(&itemsCreateItemCmdBody, "body", "", "Raw JSON body (overrides individual flags)")
	itemsCreateItemCmd.Flags().StringVar(&itemsCreateItemCmdBodyFile, "body-file", "", "Path to JSON file to use as request body")
	itemsCreateItemCmd.Flags().StringArrayVar(&itemsCreateItemCmd_acceptance, "acceptance", nil, "Measurable acceptance criteria (repeatable)")
	itemsCreateItemCmd.Flags().StringVar(&itemsCreateItemCmd_context, "context", "", "Integration points and code references for agents")
	itemsCreateItemCmd.Flags().StringArrayVar(&itemsCreateItemCmd_dependencies, "dependencies", nil, "")
	itemsCreateItemCmd.Flags().StringVar(&itemsCreateItemCmd_description, "description", "", "")
	itemsCreateItemCmd.Flags().StringVar(&itemsCreateItemCmd_objective, "objective", "", "One-sentence description of what this item delivers")
	itemsCreateItemCmd.Flags().StringVar(&itemsCreateItemCmd_outputsImpl, "outputs.impl", "", "")
	itemsCreateItemCmd.Flags().StringVar(&itemsCreateItemCmd_outputsTest, "outputs.test", "", "")
	itemsCreateItemCmd.Flags().StringVar(&itemsCreateItemCmd_outputsTypes, "outputs.types", "", "")
	itemsCreateItemCmd.Flags().StringVar(&itemsCreateItemCmd_priority, "priority", "", "(critical|high|medium|low)")
	itemsCreateItemCmd.RegisterFlagCompletionFunc("priority", func(cmd *cobra.Command, args []string, toComplete string) ([]string, cobra.ShellCompDirective) {
		return []string{"critical", "high", "medium", "low"}, cobra.ShellCompDirectiveNoFileComp
	})
	itemsCreateItemCmd.Flags().StringVar(&itemsCreateItemCmd_title, "title", "", "")
	itemsCreateItemCmd.Flags().StringVar(&itemsCreateItemCmd_type, "type", "", "(feature|bug|enhancement|task)")
	itemsCreateItemCmd.RegisterFlagCompletionFunc("type", func(cmd *cobra.Command, args []string, toComplete string) ([]string, cobra.ShellCompDirective) {
		return []string{"feature", "bug", "enhancement", "task"}, cobra.ShellCompDirectiveNoFileComp
	})
	// NOTE: required-flag enforcement is done in RunE via validate.RequireFlags
	// so that --body / --body-file can be used as an alternative to individual
	// flags. Cobra's MarkFlagRequired runs before RunE and cannot be bypassed.
}
