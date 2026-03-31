package cmd

import "github.com/spf13/cobra"

var missionsRetroCmd = &cobra.Command{
	Use:   "missions-retro",
	Short: "missions-retro",
}

func init() {
	rootCmd.AddCommand(missionsRetroCmd)
}
