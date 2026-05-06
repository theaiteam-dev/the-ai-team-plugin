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

var missionsGetToolHistogramCmd = &cobra.Command{
	Use:   "getToolHistogram <missionId>",
	Short: "Get per-agent tool-call histogram for a mission",
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		baseURL, _ := cmd.Root().PersistentFlags().GetString("base-url")
		token := os.Getenv("ATEAM_TOKEN")
		c := client.NewClient(baseURL, token)
		pathParams := map[string]string{"missionId": args[0]}
		queryParams := map[string]string{}
		resp, err := c.Do("GET", "/api/missions/{missionId}/tool-histogram", pathParams, queryParams, nil)
		if err != nil {
			return err
		}
		jsonMode, _ := cmd.Root().PersistentFlags().GetBool("json")
		noColor, _ := cmd.Root().PersistentFlags().GetBool("no-color")
		if jsonMode {
			fmt.Printf("%s\n", string(resp))
			return nil
		}
		if err := printToolHistogramTable(resp, noColor); err != nil {
			// Fall back to PrintTable, then raw body, mirroring getTokenUsage's
			// defensive style.
			if err := output.PrintTable(resp, noColor); err != nil {
				fmt.Println(string(resp))
			}
		}
		return nil
	},
}

// printToolHistogramTable flattens the nested { agents: [ { agentName, tools: [ { toolName, count } ] } ] }
// response into rows of [Agent, Tool, Count]. Returns an error if the payload
// doesn't match the expected shape so callers can fall back.
func printToolHistogramTable(resp []byte, noColor bool) error {
	var envelope struct {
		Success bool `json:"success"`
		Data    struct {
			MissionID string `json:"missionId"`
			Agents    []struct {
				AgentName string `json:"agentName"`
				Tools     []struct {
					ToolName string `json:"toolName"`
					Count    int    `json:"count"`
				} `json:"tools"`
			} `json:"agents"`
		} `json:"data"`
	}
	if err := json.Unmarshal(resp, &envelope); err != nil {
		return fmt.Errorf("unmarshal tool-histogram response: %w", err)
	}
	if len(envelope.Data.Agents) == 0 {
		fmt.Fprintln(os.Stdout, "(no tool events recorded for this mission)")
		return nil
	}

	table := tablewriter.NewWriter(os.Stdout)
	if noColor {
		table.SetBorder(true)
	}
	table.SetHeader([]string{"Agent", "Tool", "Count"})

	var grandTotal int
	for _, agent := range envelope.Data.Agents {
		for _, tool := range agent.Tools {
			table.Append([]string{agent.AgentName, tool.ToolName, fmt.Sprintf("%d", tool.Count)})
			grandTotal += tool.Count
		}
	}
	table.Render()
	fmt.Fprintf(os.Stdout, "Total tool calls: %d\n", grandTotal)
	return nil
}

func init() {
	missionsCmd.AddCommand(missionsGetToolHistogramCmd)
}
