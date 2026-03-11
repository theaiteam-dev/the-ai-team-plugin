package cmd

import (
	"fmt"
	"os"
	"github.com/spf13/cobra"
	"ateam/internal/client"
	"ateam/internal/output"
)

var (
	boardEventsBoardEventsCmd_projectId string
)

var boardEventsBoardEventsCmd = &cobra.Command{
	Use: "boardEvents",
	Short: "Server-Sent Events stream of board changes",
	Args: cobra.NoArgs,
	RunE: func(cmd *cobra.Command, args []string) error {
		baseURL, _ := cmd.Root().PersistentFlags().GetString("base-url")
		token := os.Getenv("ATEAM_TOKEN")
		c := client.NewClient(baseURL, token)
		pathParams := map[string]string{}
		queryParams := map[string]string{}
		queryParams["projectId"] = boardEventsBoardEventsCmd_projectId
		resp, err := c.Do("GET", "/api/board/events", pathParams, queryParams, nil)
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
	boardEventsCmd.AddCommand(boardEventsBoardEventsCmd)
	boardEventsBoardEventsCmd.Flags().StringVar(&boardEventsBoardEventsCmd_projectId, "projectId", "", "Fallback when X-Project-ID header cannot be set (EventSource)")
}
