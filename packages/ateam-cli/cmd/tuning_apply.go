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
	tuningApplyCmdAltitude      string
	tuningApplyCmdMergeInto     string
	tuningApplyCmdTargetSurface string
)

var tuningApplyCmd = &cobra.Command{
	Use:   "apply",
	Short: "Apply a tuning verb (accept|edit|merge) to a proposal — reject/demote are gone (see `tuning defer`)",
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
		if cmd.Flags().Changed("altitude") {
			bodyMap["altitude"] = tuningApplyCmdAltitude
		}
		if cmd.Flags().Changed("merge-into") {
			bodyMap["mergeIntoFingerprint"] = tuningApplyCmdMergeInto
		}
		if cmd.Flags().Changed("target-surface") {
			bodyMap["targetSurface"] = tuningApplyCmdTargetSurface
		}
		resp, err := c.Do("PATCH", "/api/tuning/proposals/{id}", pathParams, queryParams, bodyMap)
		if err != nil {
			// The API returns 422 SAME_MISSION_MERGE when `merge` is attempted
			// across fingerprints that only co-occur within one mission (they
			// are distinct facets of that mission's evidence, not independent
			// corroboration, and can never legitimately reach the
			// distinct-mission threshold by merging). client.Do already
			// surfaces the structured {code, message} envelope verbatim in
			// the error text (see internal/client.execute), so this just adds
			// verb-specific framing rather than a bare "PATCH failed".
			if tuningApplyCmdVerb == "merge" {
				return fmt.Errorf("merge failed: %w", err)
			}
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
	tuningApplyCmd.Flags().StringVar(&tuningApplyCmdVerb, "verb", "", "accept|edit|merge")
	tuningApplyCmd.Flags().StringVar(&tuningApplyCmdProposalText, "proposal-text", "", "Amended proposal text (edit)")
	tuningApplyCmd.Flags().StringVar(&tuningApplyCmdAltitude, "altitude", "", "Re-target altitude (edit)")
	tuningApplyCmd.Flags().StringVar(&tuningApplyCmdMergeInto, "merge-into", "", "Target fingerprint to merge into (merge)")
	tuningApplyCmd.Flags().StringVar(&tuningApplyCmdTargetSurface, "target-surface", "", "Re-target the agreed surface (edit)")
	tuningApplyCmd.MarkFlagRequired("id")
	tuningApplyCmd.MarkFlagRequired("verb")
}
