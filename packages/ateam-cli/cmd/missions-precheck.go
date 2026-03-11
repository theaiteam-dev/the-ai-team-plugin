package cmd

import "github.com/spf13/cobra"

var missionsPrecheckCmd = &cobra.Command{
	Use: "missions-precheck",
	Short: "missions-precheck",
}

func init() {
	rootCmd.AddCommand(missionsPrecheckCmd)
}
