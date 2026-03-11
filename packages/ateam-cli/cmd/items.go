package cmd

import "github.com/spf13/cobra"

var itemsCmd = &cobra.Command{
	Use: "items",
	Short: "items",
}

func init() {
	rootCmd.AddCommand(itemsCmd)
}
