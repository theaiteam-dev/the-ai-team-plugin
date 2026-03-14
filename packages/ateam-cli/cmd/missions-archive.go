package cmd

import "github.com/spf13/cobra"

var missionsArchiveCmd = &cobra.Command{
	Use: "missions-archive",
	Short: "missions-archive",
}

func init() {
	rootCmd.AddCommand(missionsArchiveCmd)
}
