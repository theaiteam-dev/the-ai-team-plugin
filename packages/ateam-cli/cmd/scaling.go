package cmd

import "github.com/spf13/cobra"

var scalingCmd = &cobra.Command{
	Use:   "scaling",
	Short: "scaling",
}

func init() {
	rootCmd.AddCommand(scalingCmd)
}
