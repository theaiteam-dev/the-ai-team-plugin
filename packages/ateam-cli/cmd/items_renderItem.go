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
	itemsRenderItemCmd_includeWorkLog bool
)

var itemsRenderItemCmd = &cobra.Command{
	Use: "renderItem <id>",
	Short: "Render item as markdown",
	Args: cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		baseURL, _ := cmd.Root().PersistentFlags().GetString("base-url")
		token := os.Getenv("ATEAM_TOKEN")
		c := client.NewClient(baseURL, token)
		pathParams := map[string]string{}
		pathParams["id"] = args[0]
		queryParams := map[string]string{}
		queryParams["includeWorkLog"] = strconv.FormatBool(itemsRenderItemCmd_includeWorkLog)
		resp, err := c.Do("GET", "/api/items/{id}/render", pathParams, queryParams, nil)
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
	itemsCmd.AddCommand(itemsRenderItemCmd)
	itemsRenderItemCmd.Flags().BoolVar(&itemsRenderItemCmd_includeWorkLog, "includeWorkLog", false, "")
}
