package cmd

import (
	"fmt"
	"os"

	"ateam/internal/client"
	"ateam/internal/output"
	"ateam/internal/validate"

	"github.com/spf13/cobra"
)

var (
	tuningProposeCmdFingerprint   []string
	tuningProposeCmdTargetSurface string
	tuningProposeCmdAltitude      string
	tuningProposeCmdProposalText  string
)

// tuningProposeCmd creates a TuningProposal. Phase A made proposals
// post-agreement and global: there is no eager "draft" step for browsing a
// card (candidates are a view over global fingerprints — see `tuning
// candidates`). This command's POST *is* the maintainer's agreement to act:
// it links one or more corroborated fingerprints to the agreed
// targetSurface/altitude/proposalText, and the API creates the proposal
// already status=accepted (gated on every linked fingerprint being
// corroborated — >=3 distinct missions — else the API returns 422
// NOT_CORROBORATED).
var tuningProposeCmd = &cobra.Command{
	Use:   "propose",
	Short: "Create a TuningProposal for corroborated fingerprint(s) — the agreement to act, not a browsing draft",
	Args:  cobra.NoArgs,
	RunE: func(cmd *cobra.Command, args []string) error {
		if err := validate.RequireFlags(cmd, "fingerprint", "target-surface", "altitude", "proposal-text"); err != nil {
			return err
		}
		baseURL, _ := cmd.Root().PersistentFlags().GetString("base-url")
		token := os.Getenv("ATEAM_TOKEN")
		c := client.NewClient(baseURL, token)
		pathParams := map[string]string{}
		queryParams := map[string]string{}
		bodyMap := map[string]interface{}{
			"fingerprints":  tuningProposeCmdFingerprint,
			"targetSurface": tuningProposeCmdTargetSurface,
			"altitude":      tuningProposeCmdAltitude,
			"proposalText":  tuningProposeCmdProposalText,
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
	tuningProposeCmd.Flags().StringArrayVar(&tuningProposeCmdFingerprint, "fingerprint", nil, "Fingerprint slug to link (repeatable; at least one required)")
	tuningProposeCmd.Flags().StringVar(&tuningProposeCmdTargetSurface, "target-surface", "", "File the proposal would change, e.g. 'agents/ba.md'")
	tuningProposeCmd.Flags().StringVar(&tuningProposeCmdAltitude, "altitude", "", "skill-text|agent-prompt|hook")
	tuningProposeCmd.Flags().StringVar(&tuningProposeCmdProposalText, "proposal-text", "", "The agreed proposal text")
}
