package cmd

import "github.com/spf13/cobra"

var missionsHealthCmd = &cobra.Command{
	Use: "missions-health",
	Short: "missions-health",
}

func init() {
	rootCmd.AddCommand(missionsHealthCmd)
}
