package cmd

import "github.com/spf13/cobra"

var learningsCmd = &cobra.Command{
	Use:   "learnings",
	Short: "learnings",
}

func init() {
	rootCmd.AddCommand(learningsCmd)
}
