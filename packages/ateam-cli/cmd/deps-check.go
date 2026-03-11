package cmd

import "github.com/spf13/cobra"

var depsCheckCmd = &cobra.Command{
	Use: "deps-check",
	Short: "deps-check",
}

func init() {
	rootCmd.AddCommand(depsCheckCmd)
}
