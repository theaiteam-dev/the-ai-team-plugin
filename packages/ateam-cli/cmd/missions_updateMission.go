package cmd

import (
	"encoding/json"
	"fmt"
	"os"
	"github.com/spf13/cobra"
	"ateam/internal/client"
	"ateam/internal/output"
	"ateam/internal/validate"
)

var (
	missionsUpdateMissionCmdBody string
	missionsUpdateMissionCmdBodyFile string
	missionsUpdateMissionCmd_testingLevel string
	missionsUpdateMissionCmd_reviewTier string
	missionsUpdateMissionCmd_profile string
)

var missionsUpdateMissionCmd = &cobra.Command{
	Use: "updateMission <missionId>",
	Short: "Update mission fields (stamp an execution contract)",
	Args: cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		baseURL, _ := cmd.Root().PersistentFlags().GetString("base-url")
		token := os.Getenv("ATEAM_TOKEN")
		c := client.NewClient(baseURL, token)
		pathParams := map[string]string{"missionId": args[0]}
		queryParams := map[string]string{}
		if missionsUpdateMissionCmdBodyFile != "" {
			fileData, err := os.ReadFile(missionsUpdateMissionCmdBodyFile)
			if err != nil {
				return fmt.Errorf("reading body-file: %w", err)
			}
			if !json.Valid(fileData) {
				return fmt.Errorf("body-file does not contain valid JSON")
			}
			missionsUpdateMissionCmdBody = string(fileData)
		}
		if missionsUpdateMissionCmdBody != "" {
			if !json.Valid([]byte(missionsUpdateMissionCmdBody)) {
				return fmt.Errorf("--body does not contain valid JSON")
			}
			var bodyObj interface{}
			_ = json.Unmarshal([]byte(missionsUpdateMissionCmdBody), &bodyObj)
			resp, err := c.Do("PATCH", "/api/missions/{missionId}", pathParams, queryParams, bodyObj)
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
		}

		testingLevelSet := cmd.Flags().Changed("testing-level")
		reviewTierSet := cmd.Flags().Changed("review-tier")
		profileSet := cmd.Flags().Changed("profile")

		bodyMap := map[string]interface{}{}
		if testingLevelSet || reviewTierSet || profileSet {
			if err := validate.RequireFlags(cmd, "testing-level", "review-tier", "profile"); err != nil {
				return fmt.Errorf("stamping an execution contract requires --testing-level, --review-tier, and --profile together: %w", err)
			}
			if err := validate.Enum("testing-level", missionsUpdateMissionCmd_testingLevel, []string{"smoke", "critical-path", "full-dod"}); err != nil {
				return err
			}
			if err := validate.Enum("review-tier", missionsUpdateMissionCmd_reviewTier, []string{"hands-on", "evidence-only", "auto"}); err != nil {
				return err
			}
			bodyMap["executionContract"] = map[string]interface{}{
				"testing_level": missionsUpdateMissionCmd_testingLevel,
				"review_tier":   missionsUpdateMissionCmd_reviewTier,
				"profile":       missionsUpdateMissionCmd_profile,
			}
		}
		if len(bodyMap) == 0 {
			return fmt.Errorf("no fields to update — pass --testing-level, --review-tier, and --profile to stamp an execution contract, or --body/--body-file")
		}

		resp, err := c.Do("PATCH", "/api/missions/{missionId}", pathParams, queryParams, bodyMap)
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
	missionsCmd.AddCommand(missionsUpdateMissionCmd)
	missionsUpdateMissionCmd.Flags().StringVar(&missionsUpdateMissionCmdBody, "body", "", "Raw JSON body (overrides individual flags)")
	missionsUpdateMissionCmd.Flags().StringVar(&missionsUpdateMissionCmdBodyFile, "body-file", "", "Path to JSON file to use as request body")
	missionsUpdateMissionCmd.Flags().StringVar(&missionsUpdateMissionCmd_testingLevel, "testing-level", "", "Execution contract testing level (smoke|critical-path|full-dod) — requires --review-tier and --profile")
	missionsUpdateMissionCmd.RegisterFlagCompletionFunc("testing-level", func(cmd *cobra.Command, args []string, toComplete string) ([]string, cobra.ShellCompDirective) {
		return []string{"smoke", "critical-path", "full-dod"}, cobra.ShellCompDirectiveNoFileComp
	})
	missionsUpdateMissionCmd.Flags().StringVar(&missionsUpdateMissionCmd_reviewTier, "review-tier", "", "Execution contract review tier (hands-on|evidence-only|auto) — requires --testing-level and --profile")
	missionsUpdateMissionCmd.RegisterFlagCompletionFunc("review-tier", func(cmd *cobra.Command, args []string, toComplete string) ([]string, cobra.ShellCompDirective) {
		return []string{"hands-on", "evidence-only", "auto"}, cobra.ShellCompDirectiveNoFileComp
	})
	missionsUpdateMissionCmd.Flags().StringVar(&missionsUpdateMissionCmd_profile, "profile", "", "Execution contract quality-profile name (free-form) — requires --testing-level and --review-tier")
	// NOTE: required-flag enforcement is done in RunE via validate.RequireFlags
	// so that --body / --body-file can be used as an alternative to individual
	// flags. Cobra's MarkFlagRequired runs before RunE and cannot be bypassed.
}
