package cmd

import (
	"fmt"
	"os"

	"ateam/internal/client"
	"ateam/internal/output"

	"github.com/spf13/cobra"
)

var tuningCandidatesCmd = &cobra.Command{
	Use:   "candidates",
	Short: "List recurrence-ranked tuning candidates, including resurfaced dismissals",
	Args:  cobra.NoArgs,
	RunE: func(cmd *cobra.Command, args []string) error {
		baseURL, _ := cmd.Root().PersistentFlags().GetString("base-url")
		token := os.Getenv("ATEAM_TOKEN")
		c := client.NewClient(baseURL, token)
		pathParams := map[string]string{}
		queryParams := map[string]string{}
		resp, err := c.Do("GET", "/api/tuning/candidates", pathParams, queryParams, nil)
		if err != nil {
			return err
		}
		jsonMode, _ := cmd.Root().PersistentFlags().GetBool("json")
		noColor, _ := cmd.Root().PersistentFlags().GetBool("no-color")
		if jsonMode {
			fmt.Fprintf(cmd.OutOrStdout(), "%s\n", string(resp))
		} else {
			if err := output.PrintTable(unwrapTuningEnvelope(resp), noColor); err != nil {
				fmt.Println(string(resp))
			}
		}
		return nil
	},
}

func init() {
	tuningCmd.AddCommand(tuningCandidatesCmd)
}
