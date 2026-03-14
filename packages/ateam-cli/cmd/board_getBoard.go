package cmd

import (
	"fmt"
	"os"
	"strconv"
	"github.com/spf13/cobra"
	"ateam/internal/client"
	"ateam/internal/output"
)

var (
	boardGetBoardCmd_includeCompleted bool
)

var boardGetBoardCmd = &cobra.Command{
	Use: "getBoard",
	Short: "Get full board state",
	Args: cobra.NoArgs,
	RunE: func(cmd *cobra.Command, args []string) error {
		baseURL, _ := cmd.Root().PersistentFlags().GetString("base-url")
		token := os.Getenv("ATEAM_TOKEN")
		c := client.NewClient(baseURL, token)
		pathParams := map[string]string{}
		queryParams := map[string]string{}
		queryParams["includeCompleted"] = strconv.FormatBool(boardGetBoardCmd_includeCompleted)
		resp, err := c.Do("GET", "/api/board", pathParams, queryParams, nil)
		if err != nil {
			return err
		}
		jsonMode, _ := cmd.Root().PersistentFlags().GetBool("json")
		noColor, _ := cmd.Root().PersistentFlags().GetBool("no-color")
		if jsonMode {
			fmt.Printf("%s\n", string(resp))
		} else {
			if err := output.PrintTable(resp, noColor); err != nil {
				fmt.Println(string(resp))
			}
		}
		return nil
	},
}

func init() {
	boardCmd.AddCommand(boardGetBoardCmd)
	boardGetBoardCmd.Flags().BoolVar(&boardGetBoardCmd_includeCompleted, "includeCompleted", false, "Include items in the done stage")
}
