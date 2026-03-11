package cmd

import "github.com/spf13/cobra"

var boardReleaseCmd = &cobra.Command{
	Use: "board-release",
	Short: "board-release",
}

func init() {
	rootCmd.AddCommand(boardReleaseCmd)
}
