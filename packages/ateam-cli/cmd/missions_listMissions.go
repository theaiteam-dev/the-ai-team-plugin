package cmd

import (
	"fmt"
	"os"
	"github.com/spf13/cobra"
	"ateam/internal/client"
	"ateam/internal/output"
	"ateam/internal/validate"
)

var (
	missionsListMissionsCmd_state string
)

var missionsListMissionsCmd = &cobra.Command{
	Use: "listMissions",
	Short: "List missions",
	Args: cobra.NoArgs,
	RunE: func(cmd *cobra.Command, args []string) error {
		baseURL, _ := cmd.Root().PersistentFlags().GetString("base-url")
		token := os.Getenv("ATEAM_TOKEN")
		c := client.NewClient(baseURL, token)
		pathParams := map[string]string{}
		queryParams := map[string]string{}
		queryParams["state"] = missionsListMissionsCmd_state
		if cmd.Flags().Changed("state") { if err := validate.Enum("state", missionsListMissionsCmd_state, []string{"initializing", "prechecking", "precheck_failure", "running", "postchecking", "completed", "failed", "archived"}); err != nil { return err } }
		resp, err := c.Do("GET", "/api/missions", pathParams, queryParams, nil)
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
	missionsCmd.AddCommand(missionsListMissionsCmd)
	missionsListMissionsCmd.Flags().StringVar(&missionsListMissionsCmd_state, "state", "", "(initializing|prechecking|precheck_failure|running|postchecking|completed|failed|archived)")
	missionsListMissionsCmd.RegisterFlagCompletionFunc("state", func(cmd *cobra.Command, args []string, toComplete string) ([]string, cobra.ShellCompDirective) {
		return []string{"initializing", "prechecking", "precheck_failure", "running", "postchecking", "completed", "failed", "archived"}, cobra.ShellCompDirectiveNoFileComp
	})
}
