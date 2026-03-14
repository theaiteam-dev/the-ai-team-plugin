package cmd

import (
	"os"

	"github.com/spf13/cobra"
)

var rootCmd = &cobra.Command{
	Use:   "ateam",
	Short: "A(i)-Team Kanban Viewer API",
}

// Execute is the conventional cobra entry point called from main.
func Execute() {
	if err := rootCmd.Execute(); err != nil {
		os.Exit(1)
	}
}

func init() {
	rootCmd.PersistentFlags().Bool("json", false, "Output raw JSON")
	rootCmd.PersistentFlags().Bool("verbose", false, "Verbose output")
	rootCmd.PersistentFlags().String("config", "", "Config file path")
	rootCmd.PersistentFlags().String("base-url", "http://localhost:3000", "API base URL")
	rootCmd.PersistentFlags().Bool("no-color", false, "Disable color output")
	// swagger-jack:custom:start init-hook
	// swagger-jack:custom:end
}
