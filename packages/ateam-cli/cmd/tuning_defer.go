package cmd

import (
	"fmt"
	"os"

	"ateam/internal/client"
	"ateam/internal/output"

	"github.com/spf13/cobra"
)

var tuningDeferCmdFingerprint string

// tuningDeferCmd hits the fingerprint-scoped defer endpoint — a durable "not
// now" (collapsed verb set: reject/demote are gone, folded into this
// watermark). Unlike the removed reject/demote verbs on `tuning apply`
// (which required an *already-existing* proposal id), defer needs nothing but
// the fingerprint slug: it sets Fingerprint.deferredAtMissions to the
// fingerprint's CURRENT distinctMissions count. The candidate walk
// (`tuning candidates`) then reports the fingerprint as `actionable: false`
// until distinctMissions climbs DEFER_MARGIN past that watermark.
var tuningDeferCmd = &cobra.Command{
	Use:   "defer",
	Short: "Durable 'not now' for a fingerprint — records a distinct-mission watermark it must climb past to resurface",
	Args:  cobra.NoArgs,
	RunE: func(cmd *cobra.Command, args []string) error {
		baseURL, _ := cmd.Root().PersistentFlags().GetString("base-url")
		token := os.Getenv("ATEAM_TOKEN")
		c := client.NewClient(baseURL, token)
		pathParams := map[string]string{"slug": tuningDeferCmdFingerprint}
		queryParams := map[string]string{}
		resp, err := c.Do("POST", "/api/tuning/fingerprints/{slug}/defer", pathParams, queryParams, nil)
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
	tuningCmd.AddCommand(tuningDeferCmd)
	tuningDeferCmd.Flags().StringVar(&tuningDeferCmdFingerprint, "fingerprint", "", "Fingerprint slug to defer")
	tuningDeferCmd.MarkFlagRequired("fingerprint")
}
