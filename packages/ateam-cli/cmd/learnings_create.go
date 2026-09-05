package cmd

import (
	"fmt"
	"os"

	"ateam/internal/client"
	"ateam/internal/output"

	"github.com/spf13/cobra"
)

var (
	learningsCreateCmdSource          string
	learningsCreateCmdSeverity        string
	learningsCreateCmdAttributedAgent string
	learningsCreateCmdTargetSurface   string
	learningsCreateCmdPattern         string
	learningsCreateCmdFingerprint     string
	learningsCreateCmdTitle           string
	learningsCreateCmdDetail          string
	learningsCreateCmdMissionId       string
	learningsCreateCmdSourceItemId    string
)

var learningsCreateCmd = &cobra.Command{
	Use:   "create",
	Short: "Capture a RetroLearning row (per-mission dedupe)",
	Args:  cobra.NoArgs,
	RunE: func(cmd *cobra.Command, args []string) error {
		baseURL, _ := cmd.Root().PersistentFlags().GetString("base-url")
		token := os.Getenv("ATEAM_TOKEN")
		c := client.NewClient(baseURL, token)
		pathParams := map[string]string{}
		queryParams := map[string]string{}
		bodyMap := map[string]interface{}{
			"source":          learningsCreateCmdSource,
			"severity":        learningsCreateCmdSeverity,
			"attributedAgent": learningsCreateCmdAttributedAgent,
			"targetSurface":   learningsCreateCmdTargetSurface,
			"pattern":         learningsCreateCmdPattern,
			"fingerprint":     learningsCreateCmdFingerprint,
			"title":           learningsCreateCmdTitle,
		}
		if cmd.Flags().Changed("detail") {
			bodyMap["detail"] = learningsCreateCmdDetail
		}
		if cmd.Flags().Changed("missionId") {
			bodyMap["missionId"] = learningsCreateCmdMissionId
		}
		if cmd.Flags().Changed("source-item-id") {
			bodyMap["sourceItemId"] = learningsCreateCmdSourceItemId
		}
		resp, err := c.Do("POST", "/api/learnings", pathParams, queryParams, bodyMap)
		if err != nil {
			return err
		}
		jsonMode, _ := cmd.Root().PersistentFlags().GetBool("json")
		noColor, _ := cmd.Root().PersistentFlags().GetBool("no-color")
		if jsonMode {
			fmt.Fprintf(cmd.OutOrStdout(), "%s\n", string(resp))
		} else {
			if err := output.PrintTable(resp, noColor); err != nil {
				fmt.Println(string(resp))
			}
		}
		return nil
	},
}

func init() {
	learningsCmd.AddCommand(learningsCreateCmd)
	learningsCreateCmd.Flags().StringVar(&learningsCreateCmdSource, "source", "", "Agent that surfaced the learning, e.g. 'stockwell', 'amy', 'lynch'")
	learningsCreateCmd.Flags().StringVar(&learningsCreateCmdSeverity, "severity", "", "'low' | 'medium' | 'high' | 'critical'")
	learningsCreateCmd.Flags().StringVar(&learningsCreateCmdAttributedAgent, "attributedAgent", "", "Agent whose behavior the learning is about")
	learningsCreateCmd.Flags().StringVar(&learningsCreateCmdTargetSurface, "targetSurface", "", "File the learning would change, e.g. 'agents/ba.md'")
	learningsCreateCmd.Flags().StringVar(&learningsCreateCmdPattern, "pattern", "", "Short pattern slug")
	learningsCreateCmd.Flags().StringVar(&learningsCreateCmdFingerprint, "fingerprint", "", "Dedup key, computed by the caller")
	learningsCreateCmd.Flags().StringVar(&learningsCreateCmdTitle, "title", "", "Short title")
	learningsCreateCmd.Flags().StringVar(&learningsCreateCmdDetail, "detail", "", "Optional longer detail")
	learningsCreateCmd.Flags().StringVar(&learningsCreateCmdMissionId, "missionId", "", "Optional mission ID; omit for backfill rows (never deduped)")
	learningsCreateCmd.Flags().StringVar(&learningsCreateCmdSourceItemId, "source-item-id", "", "Optional work item this learning was derived from — when set, dedupe keys on (missionId, sourceItemId) instead of fingerprint")
	learningsCreateCmd.MarkFlagRequired("source")
	learningsCreateCmd.MarkFlagRequired("severity")
	learningsCreateCmd.MarkFlagRequired("attributedAgent")
	learningsCreateCmd.MarkFlagRequired("targetSurface")
	learningsCreateCmd.MarkFlagRequired("pattern")
	learningsCreateCmd.MarkFlagRequired("fingerprint")
	learningsCreateCmd.MarkFlagRequired("title")
}
