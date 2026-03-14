package cmd

import "github.com/spf13/cobra"

var stagesCmd = &cobra.Command{
	Use: "stages",
	Short: "stages",
}

func init() {
	rootCmd.AddCommand(stagesCmd)
}
