package cmd

import "github.com/spf13/cobra"

var controllerCmd = &cobra.Command{
	Use:   "controller",
	Short: "Controller commands for mission orchestration",
	Long: `Commands for the A(i)-Team controller — reads board / pool / dependency
state and emits a small JSON action plan that the Hannibal orchestrator
executes each clock tick.`,
}

func init() {
	rootCmd.AddCommand(controllerCmd)
}
