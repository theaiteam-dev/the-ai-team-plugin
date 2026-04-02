package cmd

import (
	"fmt"
	"os"

	"ateam/internal/client"
	"ateam/internal/output"

	"github.com/spf13/cobra"
)

var (
	scalingComputeCmd_concurrency int
	scalingComputeCmd_memory      int
)

var scalingComputeCmd = &cobra.Command{
	Use:   "compute",
	Short: "Compute adaptive scaling parameters",
	Args:  cobra.NoArgs,
	RunE: func(cmd *cobra.Command, args []string) error {
		baseURL, _ := cmd.Root().PersistentFlags().GetString("base-url")
		token := os.Getenv("ATEAM_TOKEN")
		c := client.NewClient(baseURL, token)
		pathParams := map[string]string{}
		queryParams := map[string]string{}

		concurrencyFlag := cmd.Flags().Lookup("concurrency")
		concurrencySet := concurrencyFlag.Changed
		concurrencyValue := scalingComputeCmd_concurrency
		concurrencyFlag.Changed = false
		scalingComputeCmd_concurrency = 0

		memoryFlag := cmd.Flags().Lookup("memory")
		memorySet := memoryFlag.Changed
		memoryValue := scalingComputeCmd_memory
		memoryFlag.Changed = false
		scalingComputeCmd_memory = 0

		if concurrencySet && concurrencyValue < 1 {
			return fmt.Errorf("--concurrency must be >= 1 when provided, got %d", concurrencyValue)
		}
		if memorySet && memoryValue < 1 {
			return fmt.Errorf("--memory must be >= 1 when provided, got %d", memoryValue)
		}

		bodyMap := map[string]interface{}{}
		if concurrencySet {
			bodyMap["concurrencyOverride"] = concurrencyValue
		}
		if memorySet {
			bodyMap["availableMemoryMB"] = memoryValue
		}

		resp, err := c.Do("POST", "/api/scaling/compute", pathParams, queryParams, bodyMap)
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
	scalingCmd.AddCommand(scalingComputeCmd)
	scalingComputeCmd.Flags().IntVar(&scalingComputeCmd_concurrency, "concurrency", 0, "Override adaptive scaling with a fixed instance count (must be >= 1)")
	scalingComputeCmd.Flags().IntVar(&scalingComputeCmd_memory, "memory", 0, "Available memory in MB (auto-detected if not set)")
}
