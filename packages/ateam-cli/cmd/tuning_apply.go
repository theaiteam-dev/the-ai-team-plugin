package cmd

import (
	"fmt"
	"os"
	"strconv"

	"ateam/internal/client"
	"ateam/internal/output"

	"github.com/spf13/cobra"
)

var (
	tuningApplyCmdId            string
	tuningApplyCmdVerb          string
	tuningApplyCmdProposalText  string
	tuningApplyCmdDismissalNote string
	tuningApplyCmdAltitude      string
	tuningApplyCmdMergeInto     string
)

var tuningApplyCmd = &cobra.Command{
	Use:   "apply",
	Short: "Apply a tuning verb (accept|edit|defer|merge|demote|reject) to a proposal",
	Args:  cobra.NoArgs,
	RunE: func(cmd *cobra.Command, args []string) error {
		if _, err := strconv.Atoi(tuningApplyCmdId); err != nil {
			return fmt.Errorf("--id must be a valid integer proposal id, got %q", tuningApplyCmdId)
		}
		baseURL, _ := cmd.Root().PersistentFlags().GetString("base-url")
		token := os.Getenv("ATEAM_TOKEN")
		c := client.NewClient(baseURL, token)
		pathParams := map[string]string{"id": tuningApplyCmdId}
		queryParams := map[string]string{}
		bodyMap := map[string]interface{}{
			"verb": tuningApplyCmdVerb,
		}
		if cmd.Flags().Changed("proposal-text") {
			bodyMap["proposalText"] = tuningApplyCmdProposalText
		}
		if cmd.Flags().Changed("dismissal-note") {
			bodyMap["dismissalNote"] = tuningApplyCmdDismissalNote
		}
		if cmd.Flags().Changed("altitude") {
			bodyMap["altitude"] = tuningApplyCmdAltitude
		}
		if cmd.Flags().Changed("merge-into") {
			bodyMap["mergeIntoFingerprint"] = tuningApplyCmdMergeInto
		}
		resp, err := c.Do("PATCH", "/api/tuning/proposals/{id}", pathParams, queryParams, bodyMap)
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
	tuningCmd.AddCommand(tuningApplyCmd)
	tuningApplyCmd.Flags().StringVar(&tuningApplyCmdId, "id", "", "TuningProposal id")
	tuningApplyCmd.Flags().StringVar(&tuningApplyCmdVerb, "verb", "", "accept|edit|defer|merge|demote|reject")
	tuningApplyCmd.Flags().StringVar(&tuningApplyCmdProposalText, "proposal-text", "", "Amended proposal text (edit)")
	tuningApplyCmd.Flags().StringVar(&tuningApplyCmdDismissalNote, "dismissal-note", "", "Dismissal note (reject|demote)")
	tuningApplyCmd.Flags().StringVar(&tuningApplyCmdAltitude, "altitude", "", "Re-scoped altitude (demote)")
	tuningApplyCmd.Flags().StringVar(&tuningApplyCmdMergeInto, "merge-into", "", "Target fingerprint to merge into (merge)")
	tuningApplyCmd.MarkFlagRequired("id")
	tuningApplyCmd.MarkFlagRequired("verb")
}
