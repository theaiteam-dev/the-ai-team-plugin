package cmd

import (
	"fmt"
	"os"

	"ateam/internal/client"
	"ateam/internal/output"

	"github.com/spf13/cobra"
)

var (
	tuningProposeCmdTargetSurface string
	tuningProposeCmdAltitude      string
)

var tuningProposeCmd = &cobra.Command{
	Use:   "propose",
	Short: "Draft a TuningProposal for a target surface, clustering its live learnings",
	Args:  cobra.NoArgs,
	RunE: func(cmd *cobra.Command, args []string) error {
		baseURL, _ := cmd.Root().PersistentFlags().GetString("base-url")
		token := os.Getenv("ATEAM_TOKEN")
		c := client.NewClient(baseURL, token)
		pathParams := map[string]string{}
		queryParams := map[string]string{}
		bodyMap := map[string]interface{}{
			"targetSurface": tuningProposeCmdTargetSurface,
			"altitude":      tuningProposeCmdAltitude,
		}
		resp, err := c.Do("POST", "/api/tuning/proposals", pathParams, queryParams, bodyMap)
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
	tuningCmd.AddCommand(tuningProposeCmd)
	tuningProposeCmd.Flags().StringVar(&tuningProposeCmdTargetSurface, "target-surface", "", "File the proposal would change, e.g. 'agents/ba.md'")
	tuningProposeCmd.Flags().StringVar(&tuningProposeCmdAltitude, "altitude", "", "skill-text|agent-prompt|hook")
	tuningProposeCmd.MarkFlagRequired("target-surface")
	tuningProposeCmd.MarkFlagRequired("altitude")
}
