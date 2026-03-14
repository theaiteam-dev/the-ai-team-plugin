package cmd

import "github.com/spf13/cobra"

var missionsCmd = &cobra.Command{
	Use: "missions",
	Short: "missions",
}

func init() {
	rootCmd.AddCommand(missionsCmd)
}
