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
	itemsCreateItemCmd_dependencies []string
	itemsCreateItemCmd_description string
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
		if err := validate.Enum("priority", itemsCreateItemCmd_priority, []string{"critical", "high", "medium", "low"}); err != nil { return err }
		if err := validate.Enum("type", itemsCreateItemCmd_type, []string{"feature", "bug", "enhancement", "task"}); err != nil { return err }
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
		bodyMap := map[string]interface{}{}
		bodyMap["dependencies"] = itemsCreateItemCmd_dependencies
		bodyMap["description"] = itemsCreateItemCmd_description
		{
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
		{
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
		{
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
	itemsCreateItemCmd.Flags().StringArrayVar(&itemsCreateItemCmd_dependencies, "dependencies", nil, "")
	itemsCreateItemCmd.Flags().StringVar(&itemsCreateItemCmd_description, "description", "", "")
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
	itemsCreateItemCmd.MarkFlagRequired("description")
	itemsCreateItemCmd.MarkFlagRequired("priority")
	itemsCreateItemCmd.MarkFlagRequired("title")
	itemsCreateItemCmd.MarkFlagRequired("type")
}
