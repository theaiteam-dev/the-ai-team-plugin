package cmd

import "github.com/spf13/cobra"

var missionsPrCmd = &cobra.Command{
	Use:   "missions-pr",
	Short: "Generate and publish the mission pull request",
}

func init() {
	rootCmd.AddCommand(missionsPrCmd)
}
