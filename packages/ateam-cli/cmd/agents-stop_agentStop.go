package cmd

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"ateam/internal/client"
	"ateam/internal/output"
	"ateam/internal/validate"

	"github.com/spf13/cobra"
)

var (
	agentsStopAgentStopCmdBody     string
	agentsStopAgentStopCmdBodyFile string
	agentsStopAgentStopCmd_agent   string
	agentsStopAgentStopCmd_advance bool
	agentsStopAgentStopCmd_itemId  string
	agentsStopAgentStopCmd_outcome string
	agentsStopAgentStopCmd_returnTo string
	agentsStopAgentStopCmd_summary string
)

// pipelineNext maps agent type → next agent type in the pipeline.
// Amy has no successor (last stage).
var pipelineNext = map[string]string{
	"murdock": "ba",
	"ba":      "lynch",
	"lynch":   "amy",
}

// agentType extracts the pool role from an agent name or instance name.
// e.g. "murdock-2" → "murdock", "B.A." → "ba", "lynch" → "lynch"
func agentType(name string) string {
	return validate.NormalizeAgentType(name)
}

// claimIdleInstance atomically claims an idle instance of agentType from poolDir.
// Returns the claimed instance name (e.g. "ba-2") or "" if none available.
func claimIdleInstance(poolDir, agentType string) string {
	// Match both "ba.idle" (N=1) and "ba-1.idle", "ba-2.idle" (N>1)
	patterns := []string{
		filepath.Join(poolDir, agentType+".idle"),
		filepath.Join(poolDir, agentType+"-*.idle"),
	}
	var candidates []string
	for _, pattern := range patterns {
		matches, _ := filepath.Glob(pattern)
		candidates = append(candidates, matches...)
	}
	for _, idleFile := range candidates {
		base := strings.TrimSuffix(filepath.Base(idleFile), ".idle")
		busyFile := filepath.Join(poolDir, base+".busy")
		if err := os.Rename(idleFile, busyFile); err == nil {
			return base // won the race
		}
		// Lost the race (ENOENT) — try next candidate
	}
	return ""
}

// poolSelfRelease releases the agent's .busy file back to .idle.
// This MUST run regardless of whether the API call succeeded — otherwise
// an API error (e.g. NOT_CLAIMED) leaves orphaned .busy files that
// permanently block the pool slot.
func poolSelfRelease(agentName string) {
	missionID := os.Getenv("ATEAM_MISSION_ID")
	if missionID == "" {
		return
	}
	poolDir := filepath.Join("/tmp/.ateam-pool", filepath.Base(missionID))
	busyFile := filepath.Join(poolDir, agentName+".busy")
	idleFile := filepath.Join(poolDir, agentName+".idle")
	if err := os.Rename(busyFile, idleFile); err != nil && !os.IsNotExist(err) {
		fmt.Fprintf(os.Stderr, "POOL_WARN: failed to release %s slot: %v\n", agentName, err)
	}
}

// handlePoolManagement performs optional next-agent claim after self-release.
// Returns (claimedNext, poolAlert) where poolAlert is non-empty when no idle
// next-agent instance was available.
// NOTE: Self-release is handled separately by poolSelfRelease (called via defer).
func handlePoolManagement(agentName, outcome string, advance bool) (claimedNext, poolAlert string) {
	missionID := os.Getenv("ATEAM_MISSION_ID")
	if missionID == "" {
		fmt.Fprintln(os.Stderr, "WARNING: ATEAM_MISSION_ID not set — pool management skipped (no claimedNext will be returned)")
		return "", ""
	}

	poolDir := filepath.Join("/tmp/.ateam-pool", filepath.Base(missionID))

	// Only claim next when advancing forward through the pipeline on success
	if !advance || outcome == "rejected" || outcome == "blocked" {
		return "", ""
	}
	nextType, ok := pipelineNext[agentType(agentName)]
	if !ok {
		return "", "" // amy or unknown — no successor
	}
	claimed := claimIdleInstance(poolDir, nextType)
	if claimed == "" {
		return "", fmt.Sprintf("no idle %s instance available", nextType)
	}
	return claimed, ""
}

// injectPoolResult merges claimedNext / poolAlert into the API response JSON.
func injectPoolResult(resp []byte, claimedNext, poolAlert string) []byte {
	if claimedNext == "" && poolAlert == "" {
		return resp
	}
	var obj map[string]interface{}
	if err := json.Unmarshal(resp, &obj); err != nil {
		return resp
	}
	data, _ := obj["data"].(map[string]interface{})
	if data == nil {
		data = map[string]interface{}{}
		obj["data"] = data
	}
	if claimedNext != "" {
		data["claimedNext"] = claimedNext
	}
	if poolAlert != "" {
		data["poolAlert"] = poolAlert
	}
	out, err := json.Marshal(obj)
	if err != nil {
		return resp
	}
	return out
}

var agentsStopAgentStopCmd = &cobra.Command{
	Use:   "agentStop",
	Short: "Agent completes work on an item",
	Args:  cobra.NoArgs,
	RunE: func(cmd *cobra.Command, args []string) error {
		baseURL, _ := cmd.Root().PersistentFlags().GetString("base-url")
		token := os.Getenv("ATEAM_TOKEN")
		c := client.NewClient(baseURL, token)
		pathParams := map[string]string{}
		queryParams := map[string]string{}
		if err := validate.AgentName("agent", agentsStopAgentStopCmd_agent, []string{"Hannibal", "Face", "Murdock", "B.A.", "Amy", "Lynch", "Stockwell", "Sosa", "Tawnia"}); err != nil {
			return err
		}
		if cmd.Flags().Changed("outcome") {
			if err := validate.Enum("outcome", agentsStopAgentStopCmd_outcome, []string{"completed", "blocked", "rejected"}); err != nil {
				return err
			}
		}
		if agentsStopAgentStopCmdBodyFile != "" {
			fileData, err := os.ReadFile(agentsStopAgentStopCmdBodyFile)
			if err != nil {
				return fmt.Errorf("reading body-file: %w", err)
			}
			if !json.Valid(fileData) {
				return fmt.Errorf("body-file does not contain valid JSON")
			}
			agentsStopAgentStopCmdBody = string(fileData)
		}

		var resp []byte
		var apiErr error

		// agentName/outcome/advance used for pool management — resolved from flags or --body
		agentName := agentsStopAgentStopCmd_agent

		// Always release pool slot on exit — even if the API call fails.
		// Without this, API errors (e.g. NOT_CLAIMED when agentStart was skipped)
		// leave orphaned .busy files that permanently block the pool slot.
		defer poolSelfRelease(agentName)
		outcome := agentsStopAgentStopCmd_outcome
		advance := agentsStopAgentStopCmd_advance

		if agentsStopAgentStopCmdBody != "" {
			if !json.Valid([]byte(agentsStopAgentStopCmdBody)) {
				return fmt.Errorf("--body does not contain valid JSON")
			}
			var bodyObj map[string]interface{}
			if err := json.Unmarshal([]byte(agentsStopAgentStopCmdBody), &bodyObj); err == nil {
				if v, ok := bodyObj["agent"].(string); ok && agentName == "" {
					agentName = v
				}
				if v, ok := bodyObj["outcome"].(string); ok && outcome == "" {
					outcome = v
				}
				if v, ok := bodyObj["advance"].(bool); ok {
					advance = v
				}
			}
			resp, apiErr = c.Do("POST", "/api/agents/stop", pathParams, queryParams, bodyObj)
		} else {
			bodyMap := map[string]interface{}{}
			bodyMap["agent"] = agentsStopAgentStopCmd_agent
			bodyMap["advance"] = agentsStopAgentStopCmd_advance
			bodyMap["itemId"] = agentsStopAgentStopCmd_itemId
			bodyMap["outcome"] = agentsStopAgentStopCmd_outcome
			if cmd.Flags().Changed("return-to") {
				bodyMap["returnTo"] = agentsStopAgentStopCmd_returnTo
			}
			bodyMap["summary"] = agentsStopAgentStopCmd_summary
			resp, apiErr = c.Do("POST", "/api/agents/stop", pathParams, queryParams, bodyMap)
		}

		if apiErr != nil {
			// defer poolSelfRelease runs on exit — pool slot is always released
			return apiErr
		}

		// Check for wipExceeded — item was NOT advanced but work was logged
		var parsed struct {
			Data struct {
				WipExceeded  bool   `json:"wipExceeded"`
				BlockedStage string `json:"blockedStage"`
			} `json:"data"`
		}
		wipExceeded := json.Unmarshal(resp, &parsed) == nil && parsed.Data.WipExceeded

		// Pool management: next-agent claim only (self-release handled by defer)
		// Skip next-agent claim when WIP exceeded — item didn't advance, no handoff needed
		var claimedNext, poolAlert string
		if !wipExceeded {
			claimedNext, poolAlert = handlePoolManagement(
				agentName,
				outcome,
				advance,
			)
			resp = injectPoolResult(resp, claimedNext, poolAlert)
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

		// Surface WIP limit warning
		if wipExceeded {
			fmt.Fprintf(os.Stderr, "\nWARNING: WIP_LIMIT_EXCEEDED on '%s' stage. Work was logged but item was NOT advanced. Send ALERT to Hannibal to redispatch when capacity opens.\n", parsed.Data.BlockedStage)
		}

		// Surface pool alert so agents know to send ALERT to Hannibal
		if poolAlert != "" {
			fmt.Fprintf(os.Stderr, "\nPOOL_ALERT: %s — send ALERT to Hannibal for manual dispatch.\n", poolAlert)
		}

		return nil
	},
}

func init() {
	agentsStopCmd.AddCommand(agentsStopAgentStopCmd)
	agentsStopAgentStopCmd.Flags().StringVar(&agentsStopAgentStopCmdBody, "body", "", "Raw JSON body (overrides individual flags)")
	agentsStopAgentStopCmd.Flags().StringVar(&agentsStopAgentStopCmdBodyFile, "body-file", "", "Path to JSON file to use as request body")
	agentsStopAgentStopCmd.Flags().StringVar(&agentsStopAgentStopCmd_agent, "agent", "", "(Hannibal|Face|Murdock|B.A.|Amy|Lynch|Stockwell|Sosa|Tawnia)")
	agentsStopAgentStopCmd.Flags().BoolVar(&agentsStopAgentStopCmd_advance, "advance", true, "When true (default), advance item to next stage with WIP limit check. When false, skip stage transition — only release claim and log work.")
	agentsStopAgentStopCmd.RegisterFlagCompletionFunc("agent", func(cmd *cobra.Command, args []string, toComplete string) ([]string, cobra.ShellCompDirective) {
		return []string{"Hannibal", "Face", "Murdock", "B.A.", "Amy", "Lynch", "Stockwell", "Sosa", "Tawnia"}, cobra.ShellCompDirectiveNoFileComp
	})
	agentsStopAgentStopCmd.Flags().StringVar(&agentsStopAgentStopCmd_itemId, "itemId", "", "")
	agentsStopAgentStopCmd.Flags().StringVar(&agentsStopAgentStopCmd_outcome, "outcome", "", "(completed|blocked|rejected)")
	agentsStopAgentStopCmd.RegisterFlagCompletionFunc("outcome", func(cmd *cobra.Command, args []string, toComplete string) ([]string, cobra.ShellCompDirective) {
		return []string{"completed", "blocked", "rejected"}, cobra.ShellCompDirectiveNoFileComp
	})
	agentsStopAgentStopCmd.Flags().StringVar(&agentsStopAgentStopCmd_returnTo, "return-to", "", "Stage to return item to when outcome=rejected (ready|testing|implementing|review|probing)")
	agentsStopAgentStopCmd.Flags().StringVar(&agentsStopAgentStopCmd_summary, "summary", "", "")
	agentsStopAgentStopCmd.MarkFlagRequired("agent")
	agentsStopAgentStopCmd.MarkFlagRequired("itemId")
	agentsStopAgentStopCmd.MarkFlagRequired("summary")
}
