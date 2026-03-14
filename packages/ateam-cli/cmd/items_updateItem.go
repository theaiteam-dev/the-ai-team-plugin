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
	itemsUpdateItemCmdBody string
	itemsUpdateItemCmdBodyFile string
	itemsUpdateItemCmd_dependencies []string
	itemsUpdateItemCmd_description string
	itemsUpdateItemCmd_outputsTypes string
	itemsUpdateItemCmd_outputsImpl string
	itemsUpdateItemCmd_outputsTest string
	itemsUpdateItemCmd_priority string
	itemsUpdateItemCmd_title string
	itemsUpdateItemCmd_type string
)

var itemsUpdateItemCmd = &cobra.Command{
	Use: "updateItem <id>",
	Short: "Update a work item",
	Args: cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		baseURL, _ := cmd.Root().PersistentFlags().GetString("base-url")
		token := os.Getenv("ATEAM_TOKEN")
		c := client.NewClient(baseURL, token)
		pathParams := map[string]string{"id": args[0]}
		queryParams := map[string]string{}
		if cmd.Flags().Changed("priority") { if err := validate.Enum("priority", itemsUpdateItemCmd_priority, []string{"critical", "high", "medium", "low"}); err != nil { return err } }
		if cmd.Flags().Changed("type") { if err := validate.Enum("type", itemsUpdateItemCmd_type, []string{"feature", "bug", "enhancement", "task"}); err != nil { return err } }
		if itemsUpdateItemCmdBodyFile != "" {
			fileData, err := os.ReadFile(itemsUpdateItemCmdBodyFile)
			if err != nil {
				return fmt.Errorf("reading body-file: %w", err)
			}
			if !json.Valid(fileData) {
				return fmt.Errorf("body-file does not contain valid JSON")
			}
			itemsUpdateItemCmdBody = string(fileData)
		}
		if itemsUpdateItemCmdBody != "" {
			if !json.Valid([]byte(itemsUpdateItemCmdBody)) {
				return fmt.Errorf("--body does not contain valid JSON")
			}
			var bodyObj interface{}
			_ = json.Unmarshal([]byte(itemsUpdateItemCmdBody), &bodyObj)
			resp, err := c.Do("PATCH", "/api/items/{id}", pathParams, queryParams, bodyObj)
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
		if cmd.Flags().Changed("dependencies") {
			bodyMap["dependencies"] = itemsUpdateItemCmd_dependencies
		}
		if cmd.Flags().Changed("description") {
			bodyMap["description"] = itemsUpdateItemCmd_description
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
			_cur[_parts[len(_parts)-1]] = itemsUpdateItemCmd_outputsTypes
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
			_cur[_parts[len(_parts)-1]] = itemsUpdateItemCmd_outputsImpl
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
			_cur[_parts[len(_parts)-1]] = itemsUpdateItemCmd_outputsTest
		}
		if cmd.Flags().Changed("priority") {
			bodyMap["priority"] = itemsUpdateItemCmd_priority
		}
		if cmd.Flags().Changed("title") {
			bodyMap["title"] = itemsUpdateItemCmd_title
		}
		if cmd.Flags().Changed("type") {
			bodyMap["type"] = itemsUpdateItemCmd_type
		}
		if len(bodyMap) == 0 {
			return fmt.Errorf("no fields to update")
		}
		resp, err := c.Do("PATCH", "/api/items/{id}", pathParams, queryParams, bodyMap)
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
	itemsCmd.AddCommand(itemsUpdateItemCmd)
	itemsUpdateItemCmd.Flags().StringVar(&itemsUpdateItemCmdBody, "body", "", "Raw JSON body (overrides individual flags)")
	itemsUpdateItemCmd.Flags().StringVar(&itemsUpdateItemCmdBodyFile, "body-file", "", "Path to JSON file to use as request body")
	itemsUpdateItemCmd.Flags().StringArrayVar(&itemsUpdateItemCmd_dependencies, "dependencies", nil, "")
	itemsUpdateItemCmd.Flags().StringVar(&itemsUpdateItemCmd_description, "description", "", "")
	itemsUpdateItemCmd.Flags().StringVar(&itemsUpdateItemCmd_outputsTypes, "outputs.types", "", "")
	itemsUpdateItemCmd.Flags().StringVar(&itemsUpdateItemCmd_outputsImpl, "outputs.impl", "", "")
	itemsUpdateItemCmd.Flags().StringVar(&itemsUpdateItemCmd_outputsTest, "outputs.test", "", "")
	itemsUpdateItemCmd.Flags().StringVar(&itemsUpdateItemCmd_priority, "priority", "", "(critical|high|medium|low)")
	itemsUpdateItemCmd.RegisterFlagCompletionFunc("priority", func(cmd *cobra.Command, args []string, toComplete string) ([]string, cobra.ShellCompDirective) {
		return []string{"critical", "high", "medium", "low"}, cobra.ShellCompDirectiveNoFileComp
	})
	itemsUpdateItemCmd.Flags().StringVar(&itemsUpdateItemCmd_title, "title", "", "")
	itemsUpdateItemCmd.Flags().StringVar(&itemsUpdateItemCmd_type, "type", "", "(feature|bug|enhancement|task)")
	itemsUpdateItemCmd.RegisterFlagCompletionFunc("type", func(cmd *cobra.Command, args []string, toComplete string) ([]string, cobra.ShellCompDirective) {
		return []string{"feature", "bug", "enhancement", "task"}, cobra.ShellCompDirectiveNoFileComp
	})
}
