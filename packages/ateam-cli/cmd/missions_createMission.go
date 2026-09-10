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
	missionsCreateMissionCmdBody string
	missionsCreateMissionCmdBodyFile string
	missionsCreateMissionCmd_force bool
	missionsCreateMissionCmd_name string
	missionsCreateMissionCmd_prdPath string
	missionsCreateMissionCmd_concurrency int
	missionsCreateMissionCmd_testingLevel string
	missionsCreateMissionCmd_reviewTier string
	missionsCreateMissionCmd_profile string
)

var missionsCreateMissionCmd = &cobra.Command{
	Use: "createMission",
	Short: "Create a mission",
	Args: cobra.NoArgs,
	RunE: func(cmd *cobra.Command, args []string) error {
		baseURL, _ := cmd.Root().PersistentFlags().GetString("base-url")
		token := os.Getenv("ATEAM_TOKEN")
		c := client.NewClient(baseURL, token)
		pathParams := map[string]string{}
		queryParams := map[string]string{}
		if missionsCreateMissionCmdBodyFile != "" {
			fileData, err := os.ReadFile(missionsCreateMissionCmdBodyFile)
			if err != nil {
				return fmt.Errorf("reading body-file: %w", err)
			}
			if !json.Valid(fileData) {
				return fmt.Errorf("body-file does not contain valid JSON")
			}
			missionsCreateMissionCmdBody = string(fileData)
		}
		if missionsCreateMissionCmdBody != "" {
			if !json.Valid([]byte(missionsCreateMissionCmdBody)) {
				return fmt.Errorf("--body does not contain valid JSON")
			}
			var bodyObj interface{}
			_ = json.Unmarshal([]byte(missionsCreateMissionCmdBody), &bodyObj)
			resp, err := c.Do("POST", "/api/missions", pathParams, queryParams, bodyObj)
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
		if err := validate.RequireFlags(cmd, "name", "prdPath"); err != nil {
			return err
		}
		concurrencySet := cmd.Flags().Changed("concurrency")
		concurrencyValue := missionsCreateMissionCmd_concurrency

		if concurrencySet && concurrencyValue < 1 {
			return fmt.Errorf("--concurrency must be >= 1 when provided, got %d", concurrencyValue)
		}

		testingLevelSet := cmd.Flags().Changed("testing-level")
		reviewTierSet := cmd.Flags().Changed("review-tier")
		profileSet := cmd.Flags().Changed("profile")
		if testingLevelSet || reviewTierSet || profileSet {
			if err := validate.RequireFlags(cmd, "testing-level", "review-tier", "profile"); err != nil {
				return fmt.Errorf("an execution contract requires --testing-level, --review-tier, and --profile together: %w", err)
			}
			if err := validate.Enum("testing-level", missionsCreateMissionCmd_testingLevel, []string{"smoke", "critical-path", "full-dod"}); err != nil {
				return err
			}
			if err := validate.Enum("review-tier", missionsCreateMissionCmd_reviewTier, []string{"hands-on", "evidence-only", "auto"}); err != nil {
				return err
			}
		}

		bodyMap := map[string]interface{}{}
		bodyMap["force"] = missionsCreateMissionCmd_force
		bodyMap["name"] = missionsCreateMissionCmd_name
		bodyMap["prdPath"] = missionsCreateMissionCmd_prdPath
		if concurrencySet {
			bodyMap["concurrencyOverride"] = concurrencyValue
		}
		if testingLevelSet || reviewTierSet || profileSet {
			bodyMap["executionContract"] = map[string]interface{}{
				"testing_level": missionsCreateMissionCmd_testingLevel,
				"review_tier":   missionsCreateMissionCmd_reviewTier,
				"profile":       missionsCreateMissionCmd_profile,
			}
		}
		resp, err := c.Do("POST", "/api/missions", pathParams, queryParams, bodyMap)
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
	missionsCmd.AddCommand(missionsCreateMissionCmd)
	missionsCreateMissionCmd.Flags().StringVar(&missionsCreateMissionCmdBody, "body", "", "Raw JSON body (overrides individual flags)")
	missionsCreateMissionCmd.Flags().StringVar(&missionsCreateMissionCmdBodyFile, "body-file", "", "Path to JSON file to use as request body")
	missionsCreateMissionCmd.Flags().BoolVar(&missionsCreateMissionCmd_force, "force", false, "")
	missionsCreateMissionCmd.Flags().StringVar(&missionsCreateMissionCmd_name, "name", "", "")
	missionsCreateMissionCmd.Flags().StringVar(&missionsCreateMissionCmd_prdPath, "prdPath", "", "")
	missionsCreateMissionCmd.Flags().IntVar(&missionsCreateMissionCmd_concurrency, "concurrency", 0, "Override adaptive scaling with a fixed instance count (must be >= 1)")
	missionsCreateMissionCmd.Flags().StringVar(&missionsCreateMissionCmd_testingLevel, "testing-level", "", "Execution contract testing level (smoke|critical-path|full-dod) — requires --review-tier and --profile")
	missionsCreateMissionCmd.RegisterFlagCompletionFunc("testing-level", func(cmd *cobra.Command, args []string, toComplete string) ([]string, cobra.ShellCompDirective) {
		return []string{"smoke", "critical-path", "full-dod"}, cobra.ShellCompDirectiveNoFileComp
	})
	missionsCreateMissionCmd.Flags().StringVar(&missionsCreateMissionCmd_reviewTier, "review-tier", "", "Execution contract review tier (hands-on|evidence-only|auto) — requires --testing-level and --profile")
	missionsCreateMissionCmd.RegisterFlagCompletionFunc("review-tier", func(cmd *cobra.Command, args []string, toComplete string) ([]string, cobra.ShellCompDirective) {
		return []string{"hands-on", "evidence-only", "auto"}, cobra.ShellCompDirectiveNoFileComp
	})
	missionsCreateMissionCmd.Flags().StringVar(&missionsCreateMissionCmd_profile, "profile", "", "Execution contract quality-profile name (free-form) — requires --testing-level and --review-tier")
	// NOTE: required-flag enforcement is done in RunE via validate.RequireFlags
	// so that --body / --body-file can be used as an alternative to individual
	// flags. Cobra's MarkFlagRequired runs before RunE and cannot be bypassed.
}
