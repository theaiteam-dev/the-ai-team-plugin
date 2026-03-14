package cmd

import "github.com/spf13/cobra"

var activityCmd = &cobra.Command{
	Use: "activity",
	Short: "activity",
}

func init() {
	rootCmd.AddCommand(activityCmd)
}
