package cmd

import "github.com/spf13/cobra"

var missionsCurrentCmd = &cobra.Command{
	Use: "missions-current",
	Short: "missions-current",
}

func init() {
	rootCmd.AddCommand(missionsCurrentCmd)
}
