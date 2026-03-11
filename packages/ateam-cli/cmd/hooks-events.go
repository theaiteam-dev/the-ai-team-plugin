package cmd

import "github.com/spf13/cobra"

var hooksEventsCmd = &cobra.Command{
	Use: "hooks-events",
	Short: "hooks-events",
}

func init() {
	rootCmd.AddCommand(hooksEventsCmd)
}
