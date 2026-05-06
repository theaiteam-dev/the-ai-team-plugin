package cmd

import (
	"errors"
	"os"

	"github.com/spf13/cobra"
)

var rootCmd = &cobra.Command{
	Use:     "ateam",
	Short:   "A(i)-Team Kanban Viewer API",
	Version: Version,
}

// Execute is the conventional cobra entry point called from main.
//
// Pool verbs return a *PoolError when they need a specific exit code (see
// pool.go for the contract). Any other error falls through to exit code 1.
func Execute() {
	if err := rootCmd.Execute(); err != nil {
		var poolErr *PoolError
		if errors.As(err, &poolErr) {
			os.Exit(poolErr.ExitCode)
		}
		os.Exit(1)
	}
}

func init() {
	rootCmd.PersistentFlags().Bool("json", false, "Output raw JSON")
	rootCmd.PersistentFlags().Bool("verbose", false, "Verbose output")
	rootCmd.PersistentFlags().String("config", "", "Config file path")

	defaultBaseURL := "http://localhost:3000"
	if envURL := os.Getenv("ATEAM_API_URL"); envURL != "" {
		defaultBaseURL = envURL
	}
	rootCmd.PersistentFlags().String("base-url", defaultBaseURL, "API base URL (env: ATEAM_API_URL)")

	rootCmd.PersistentFlags().Bool("no-color", false, "Disable color output")
	// swagger-jack:custom:start init-hook
	// swagger-jack:custom:end
}
