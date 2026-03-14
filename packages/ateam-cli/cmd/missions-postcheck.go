package cmd

import "github.com/spf13/cobra"

var missionsPostcheckCmd = &cobra.Command{
	Use: "missions-postcheck",
	Short: "missions-postcheck",
}

func init() {
	rootCmd.AddCommand(missionsPostcheckCmd)
}
