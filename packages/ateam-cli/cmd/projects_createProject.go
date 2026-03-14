package cmd

import (
	"encoding/json"
	"fmt"
	"os"
	"github.com/spf13/cobra"
	"ateam/internal/client"
	"ateam/internal/output"
)

var (
	projectsCreateProjectCmdBody string
	projectsCreateProjectCmdBodyFile string
	projectsCreateProjectCmd_id string
	projectsCreateProjectCmd_name string
)

var projectsCreateProjectCmd = &cobra.Command{
	Use: "createProject",
	Short: "Create a project",
	Args: cobra.NoArgs,
	RunE: func(cmd *cobra.Command, args []string) error {
		baseURL, _ := cmd.Root().PersistentFlags().GetString("base-url")
		token := os.Getenv("ATEAM_TOKEN")
		c := client.NewClient(baseURL, token)
		pathParams := map[string]string{}
		queryParams := map[string]string{}
		if projectsCreateProjectCmdBodyFile != "" {
			fileData, err := os.ReadFile(projectsCreateProjectCmdBodyFile)
			if err != nil {
				return fmt.Errorf("reading body-file: %w", err)
			}
			if !json.Valid(fileData) {
				return fmt.Errorf("body-file does not contain valid JSON")
			}
			projectsCreateProjectCmdBody = string(fileData)
		}
		if projectsCreateProjectCmdBody != "" {
			if !json.Valid([]byte(projectsCreateProjectCmdBody)) {
				return fmt.Errorf("--body does not contain valid JSON")
			}
			var bodyObj interface{}
			_ = json.Unmarshal([]byte(projectsCreateProjectCmdBody), &bodyObj)
			resp, err := c.Do("POST", "/api/projects", pathParams, queryParams, bodyObj)
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
		}
		bodyMap := map[string]interface{}{}
		bodyMap["id"] = projectsCreateProjectCmd_id
		bodyMap["name"] = projectsCreateProjectCmd_name
		resp, err := c.Do("POST", "/api/projects", pathParams, queryParams, bodyMap)
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
	projectsCmd.AddCommand(projectsCreateProjectCmd)
	projectsCreateProjectCmd.Flags().StringVar(&projectsCreateProjectCmdBody, "body", "", "Raw JSON body (overrides individual flags)")
	projectsCreateProjectCmd.Flags().StringVar(&projectsCreateProjectCmdBodyFile, "body-file", "", "Path to JSON file to use as request body")
	projectsCreateProjectCmd.Flags().StringVar(&projectsCreateProjectCmd_id, "id", "", "")
	projectsCreateProjectCmd.Flags().StringVar(&projectsCreateProjectCmd_name, "name", "", "")
	projectsCreateProjectCmd.MarkFlagRequired("id")
	projectsCreateProjectCmd.MarkFlagRequired("name")
}
