package cmd

import "github.com/spf13/cobra"

var boardEventsCmd = &cobra.Command{
	Use: "board-events",
	Short: "board-events",
}

func init() {
	rootCmd.AddCommand(boardEventsCmd)
}
