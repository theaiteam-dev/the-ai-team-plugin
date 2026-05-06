package cmd

import (
	"encoding/json"
	"fmt"
	"os"

	"github.com/olekukonko/tablewriter"
	"github.com/spf13/cobra"

	"ateam/internal/client"
	"ateam/internal/output"
)

var missionsGetSkillUsageCmd = &cobra.Command{
	Use:   "getSkillUsage <missionId>",
	Short: "Get per-agent Skill invocations with distinct-args counts",
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		baseURL, _ := cmd.Root().PersistentFlags().GetString("base-url")
		token := os.Getenv("ATEAM_TOKEN")
		c := client.NewClient(baseURL, token)
		pathParams := map[string]string{"missionId": args[0]}
		queryParams := map[string]string{}
		resp, err := c.Do("GET", "/api/missions/{missionId}/skill-usage", pathParams, queryParams, nil)
		if err != nil {
			return err
		}
		jsonMode, _ := cmd.Root().PersistentFlags().GetBool("json")
		noColor, _ := cmd.Root().PersistentFlags().GetBool("no-color")
		if jsonMode {
			fmt.Printf("%s\n", string(resp))
			return nil
		}
		if err := printSkillUsageTable(resp, noColor); err != nil {
			// Fall back to PrintTable, then raw body, mirroring getTokenUsage's
			// defensive style.
			if err := output.PrintTable(resp, noColor); err != nil {
				fmt.Println(string(resp))
			}
		}
		return nil
	},
}

// printSkillUsageTable flattens the nested
// { agents: [ { agentName, skills: [ { skillName, invocations, distinctArgs } ] } ] }
// response into rows of [Agent, Skill, Invocations, Distinct Args].
func printSkillUsageTable(resp []byte, noColor bool) error {
	var envelope struct {
		Success bool `json:"success"`
		Data    struct {
			MissionID string `json:"missionId"`
			Agents    []struct {
				AgentName string `json:"agentName"`
				Skills    []struct {
					SkillName    string `json:"skillName"`
					Invocations  int    `json:"invocations"`
					DistinctArgs int    `json:"distinctArgs"`
				} `json:"skills"`
			} `json:"agents"`
		} `json:"data"`
	}
	if err := json.Unmarshal(resp, &envelope); err != nil {
		return fmt.Errorf("unmarshal skill-usage response: %w", err)
	}
	if len(envelope.Data.Agents) == 0 {
		fmt.Fprintln(os.Stdout, "(no skill invocations recorded for this mission)")
		return nil
	}

	table := tablewriter.NewWriter(os.Stdout)
	if noColor {
		table.SetBorder(true)
	}
	table.SetHeader([]string{"Agent", "Skill", "Invocations", "Distinct Args"})

	var grandTotal int
	for _, agent := range envelope.Data.Agents {
		for _, skill := range agent.Skills {
			table.Append([]string{
				agent.AgentName,
				skill.SkillName,
				fmt.Sprintf("%d", skill.Invocations),
				fmt.Sprintf("%d", skill.DistinctArgs),
			})
			grandTotal += skill.Invocations
		}
	}
	table.Render()
	fmt.Fprintf(os.Stdout, "Total skill invocations: %d\n", grandTotal)
	return nil
}

func init() {
	missionsCmd.AddCommand(missionsGetSkillUsageCmd)
}
