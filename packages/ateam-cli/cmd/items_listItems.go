package cmd

import (
	"fmt"
	"os"
	"strconv"
	"github.com/spf13/cobra"
	"ateam/internal/client"
	"ateam/internal/output"
	"ateam/internal/validate"
)

var (
	itemsListItemsCmd_stage string
	itemsListItemsCmd_type string
	itemsListItemsCmd_priority string
	itemsListItemsCmd_agent string
	itemsListItemsCmd_includeArchived bool
)

var itemsListItemsCmd = &cobra.Command{
	Use: "listItems",
	Short: "List work items",
	Args: cobra.NoArgs,
	RunE: func(cmd *cobra.Command, args []string) error {
		baseURL, _ := cmd.Root().PersistentFlags().GetString("base-url")
		token := os.Getenv("ATEAM_TOKEN")
		c := client.NewClient(baseURL, token)
		pathParams := map[string]string{}
		queryParams := map[string]string{}
		queryParams["stage"] = itemsListItemsCmd_stage
		queryParams["type"] = itemsListItemsCmd_type
		queryParams["priority"] = itemsListItemsCmd_priority
		queryParams["agent"] = itemsListItemsCmd_agent
		queryParams["includeArchived"] = strconv.FormatBool(itemsListItemsCmd_includeArchived)
		if cmd.Flags().Changed("stage") { if err := validate.Enum("stage", itemsListItemsCmd_stage, []string{"briefings", "ready", "testing", "implementing", "review", "probing", "done", "blocked"}); err != nil { return err } }
		if cmd.Flags().Changed("type") { if err := validate.Enum("type", itemsListItemsCmd_type, []string{"feature", "bug", "enhancement", "task"}); err != nil { return err } }
		if cmd.Flags().Changed("priority") { if err := validate.Enum("priority", itemsListItemsCmd_priority, []string{"critical", "high", "medium", "low"}); err != nil { return err } }
		resp, err := c.Do("GET", "/api/items", pathParams, queryParams, nil)
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
	itemsCmd.AddCommand(itemsListItemsCmd)
	itemsListItemsCmd.Flags().StringVar(&itemsListItemsCmd_stage, "stage", "", "(briefings|ready|testing|implementing|review|probing|done|blocked)")
	itemsListItemsCmd.RegisterFlagCompletionFunc("stage", func(cmd *cobra.Command, args []string, toComplete string) ([]string, cobra.ShellCompDirective) {
		return []string{"briefings", "ready", "testing", "implementing", "review", "probing", "done", "blocked"}, cobra.ShellCompDirectiveNoFileComp
	})
	itemsListItemsCmd.Flags().StringVar(&itemsListItemsCmd_type, "type", "", "(feature|bug|enhancement|task)")
	itemsListItemsCmd.RegisterFlagCompletionFunc("type", func(cmd *cobra.Command, args []string, toComplete string) ([]string, cobra.ShellCompDirective) {
		return []string{"feature", "bug", "enhancement", "task"}, cobra.ShellCompDirectiveNoFileComp
	})
	itemsListItemsCmd.Flags().StringVar(&itemsListItemsCmd_priority, "priority", "", "(critical|high|medium|low)")
	itemsListItemsCmd.RegisterFlagCompletionFunc("priority", func(cmd *cobra.Command, args []string, toComplete string) ([]string, cobra.ShellCompDirective) {
		return []string{"critical", "high", "medium", "low"}, cobra.ShellCompDirectiveNoFileComp
	})
	itemsListItemsCmd.Flags().StringVar(&itemsListItemsCmd_agent, "agent", "", "Filter by assigned agent name, or \"null\" for unassigned")
	itemsListItemsCmd.Flags().BoolVar(&itemsListItemsCmd_includeArchived, "includeArchived", false, "")
}
