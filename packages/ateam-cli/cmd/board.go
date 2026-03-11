package cmd

import "github.com/spf13/cobra"

var boardCmd = &cobra.Command{
	Use: "board",
	Short: "board",
}

func init() {
	rootCmd.AddCommand(boardCmd)
}
