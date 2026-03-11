package cmd

import "github.com/spf13/cobra"

var agentsStopCmd = &cobra.Command{
	Use: "agents-stop",
	Short: "agents-stop",
}

func init() {
	rootCmd.AddCommand(agentsStopCmd)
}
