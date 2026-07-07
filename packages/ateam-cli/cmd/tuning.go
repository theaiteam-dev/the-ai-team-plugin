package cmd

import (
	"encoding/json"

	"github.com/spf13/cobra"
)

var tuningCmd = &cobra.Command{
	Use:   "tuning",
	Short: "tuning",
}

func init() {
	rootCmd.AddCommand(tuningCmd)
}

// unwrapTuningEnvelope extracts the "data" field of a {success,data} API
// envelope before handing a response to output.PrintTable. Without this,
// PrintTable's array-of-objects branch never fires for the real API's
// enveloped responses — a top-level {success,data:[...]} object falls into
// the key/value branch instead, rendering "data" as an unreadable Go %v dump
// of the nested slice rather than one table row per item. Responses with no
// top-level "data" key (e.g. bare arrays/objects, as used by this package's
// stubbed tests) pass through unchanged.
func unwrapTuningEnvelope(resp []byte) []byte {
	var envelope map[string]interface{}
	if err := json.Unmarshal(resp, &envelope); err != nil {
		return resp
	}
	data, ok := envelope["data"]
	if !ok {
		return resp
	}
	encoded, err := json.Marshal(data)
	if err != nil {
		return resp
	}
	return encoded
}
