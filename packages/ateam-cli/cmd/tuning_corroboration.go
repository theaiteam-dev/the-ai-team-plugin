package cmd

import (
	"fmt"
	"os"

	"ateam/internal/client"
	"ateam/internal/output"

	"github.com/spf13/cobra"
)

var tuningCorroborationCmdFingerprint string

// tuningCorroborationCmd reads the GLOBAL distinct-mission count and
// corroborated flag for ONE fingerprint (GET /api/tuning/corroboration).
// Previously the tuning agent had to shell a raw curl for this endpoint, which
// carries no auth headers and is rejected by zero-trust (Cloudflare Access /
// Authentik). Response shape: { distinctMissions, corroborated }.
var tuningCorroborationCmd = &cobra.Command{
	Use:   "corroboration",
	Short: "Global distinct-mission count + corroborated flag for one fingerprint",
	Args:  cobra.NoArgs,
	RunE: func(cmd *cobra.Command, args []string) error {
		baseURL, _ := cmd.Root().PersistentFlags().GetString("base-url")
		token := os.Getenv("ATEAM_TOKEN")
		c := client.NewClient(baseURL, token)
		pathParams := map[string]string{}
		queryParams := map[string]string{"fingerprint": tuningCorroborationCmdFingerprint}
		resp, err := c.Do("GET", "/api/tuning/corroboration", pathParams, queryParams, nil)
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
	tuningCmd.AddCommand(tuningCorroborationCmd)
	tuningCorroborationCmd.Flags().StringVar(&tuningCorroborationCmdFingerprint, "fingerprint", "", "Fingerprint slug to check")
	tuningCorroborationCmd.MarkFlagRequired("fingerprint")
}
