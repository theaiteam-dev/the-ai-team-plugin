package cmd

import "github.com/spf13/cobra"

var agentsStartCmd = &cobra.Command{
	Use: "agents-start",
	Short: "agents-start",
}

func init() {
	rootCmd.AddCommand(agentsStartCmd)
}
