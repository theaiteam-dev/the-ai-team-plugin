package cmd

import "github.com/spf13/cobra"

var poolCmd = &cobra.Command{
	Use:   "pool",
	Short: "Inspect the local file-based instance pool",
}

func init() {
	rootCmd.AddCommand(poolCmd)
}
