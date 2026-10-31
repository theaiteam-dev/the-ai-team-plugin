package cmd

import "github.com/spf13/cobra"

var itemsCommitCmd = &cobra.Command{
	Use:   "items-commit",
	Short: "Commit work items that are already in the pipeline",
}

func init() {
	rootCmd.AddCommand(itemsCommitCmd)
}
