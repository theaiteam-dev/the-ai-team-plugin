package cmd

import "github.com/spf13/cobra"

var boardMoveCmd = &cobra.Command{
	Use: "board-move",
	Short: "board-move",
}

func init() {
	rootCmd.AddCommand(boardMoveCmd)
}
