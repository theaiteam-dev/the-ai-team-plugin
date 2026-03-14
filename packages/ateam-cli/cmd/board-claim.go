package cmd

import "github.com/spf13/cobra"

var boardClaimCmd = &cobra.Command{
	Use: "board-claim",
	Short: "board-claim",
}

func init() {
	rootCmd.AddCommand(boardClaimCmd)
}
