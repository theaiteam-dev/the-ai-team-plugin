package cmd

import "github.com/spf13/cobra"

var checkpointCmd = &cobra.Command{
	Use:   "checkpoint",
	Short: "Inspect and manage the controller checkpoint for a mission",
	Long: `Subcommands for reading, writing, and confirming actions in the
controller checkpoint — the persisted state that survives between
tick invocations.

  get     — read the full checkpoint document
  put     — upsert a checkpoint document (seeding / debug)
  confirm — atomically append an action ID to confirmedActionIds`,
}

func init() {
	controllerCmd.AddCommand(checkpointCmd)
}
