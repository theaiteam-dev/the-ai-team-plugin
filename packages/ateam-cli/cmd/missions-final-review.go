package cmd

import "github.com/spf13/cobra"

var missionsFinalReviewCmd = &cobra.Command{
	Use:   "missions-final-review",
	Short: "missions-final-review",
}

func init() {
	rootCmd.AddCommand(missionsFinalReviewCmd)
}
