package cmd

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/olekukonko/tablewriter"
	"github.com/spf13/cobra"
)

var poolStatusCmd = &cobra.Command{
	Use:   "status",
	Short: "Show idle/busy state of the local instance pool",
	Long: `Reads /tmp/.ateam-pool/$ATEAM_MISSION_ID/ and reports which agents are
idle vs. busy. This is the recommended way for Hannibal to inspect pool
state — DO NOT shell out to ` + "`ls`" + ` and grep .idle/.busy files manually.

In --json mode the output shape is:
  {
    "missionId":     "M-...",
    "poolDir":       "/tmp/.ateam-pool/M-...",
    "poolDirExists": true,
    "idle":          ["ba-1", "lynch-2", ...],
    "busy":          ["murdock-1", ...],
    "byType":        { "murdock": {"idle": 1, "busy": 1}, ... }
  }

When the pool dir does not exist, "poolDirExists" is false and the idle/busy/
byType fields are empty — the schema stays stable so consumers can branch on
the boolean rather than guessing.`,
	Args: cobra.NoArgs,
	RunE: func(cmd *cobra.Command, args []string) error {
		missionID := os.Getenv("ATEAM_MISSION_ID")
		if err := validateMissionID(missionID); err != nil {
			return err
		}
		poolDir := filepath.Join("/tmp", ".ateam-pool", missionID)

		// Distinguish "no pool yet" from "empty pool" — both have zero idle
		// and zero busy entries, but mean very different things to the caller.
		poolDirExists := true
		if _, err := os.Stat(poolDir); err != nil {
			if os.IsNotExist(err) {
				poolDirExists = false
			} else {
				return newPoolError(PoolExitGeneric, "stat pool dir %s: %v", poolDir, err)
			}
		}

		jsonMode, _ := cmd.Root().PersistentFlags().GetBool("json")
		noColor, _ := cmd.Root().PersistentFlags().GetBool("no-color")

		var idle, busy []string
		if poolDirExists {
			var err error
			idle, busy, err = scanPool(poolDir)
			if err != nil {
				return newPoolError(PoolExitGeneric, "%v", err)
			}
		} else {
			idle = []string{}
			busy = []string{}
		}

		if jsonMode {
			out := map[string]interface{}{
				"missionId":     missionID,
				"poolDir":       poolDir,
				"poolDirExists": poolDirExists,
				"idle":          idle,
				"busy":          busy,
				"byType":        summarizeByType(idle, busy),
			}
			b, err := json.MarshalIndent(out, "", "  ")
			if err != nil {
				return newPoolError(PoolExitGeneric, "marshal json: %v", err)
			}
			fmt.Fprintln(cmd.OutOrStdout(), string(b))
			return nil
		}

		if !poolDirExists {
			fmt.Fprintf(cmd.OutOrStdout(),
				"Pool dir does not exist: %s (run 'ateam pool init')\n", poolDir)
			return nil
		}
		printPoolTable(cmd.OutOrStdout(), idle, busy, noColor)
		return nil
	},
}

// scanPool walks poolDir once and partitions instance names into idle/busy.
// Caller is responsible for ensuring poolDir exists; a missing directory
// here is treated as a real error so callers don't silently mask it.
func scanPool(poolDir string) (idle, busy []string, err error) {
	entries, err := os.ReadDir(poolDir)
	if err != nil {
		return nil, nil, fmt.Errorf("read pool dir %s: %w", poolDir, err)
	}
	for _, e := range entries {
		name := e.Name()
		switch {
		case strings.HasSuffix(name, ".idle"):
			idle = append(idle, strings.TrimSuffix(name, ".idle"))
		case strings.HasSuffix(name, ".busy"):
			busy = append(busy, strings.TrimSuffix(name, ".busy"))
		}
	}
	sort.Strings(idle)
	sort.Strings(busy)
	if idle == nil {
		idle = []string{}
	}
	if busy == nil {
		busy = []string{}
	}
	return idle, busy, nil
}

func summarizeByType(idle, busy []string) map[string]map[string]int {
	out := map[string]map[string]int{}
	for _, n := range idle {
		t := instanceType(n)
		if _, ok := out[t]; !ok {
			out[t] = map[string]int{"idle": 0, "busy": 0}
		}
		out[t]["idle"]++
	}
	for _, n := range busy {
		t := instanceType(n)
		if _, ok := out[t]; !ok {
			out[t] = map[string]int{"idle": 0, "busy": 0}
		}
		out[t]["busy"]++
	}
	return out
}

// instanceType strips the trailing -N suffix from an instance name.
// "murdock-2" → "murdock", "ba" → "ba".
func instanceType(name string) string {
	if i := strings.LastIndex(name, "-"); i >= 0 {
		return name[:i]
	}
	return name
}

func printPoolTable(w io.Writer, idle, busy []string, noColor bool) {
	if len(idle) == 0 && len(busy) == 0 {
		fmt.Fprintln(w, "(pool is empty — no .idle or .busy files found)")
		return
	}
	table := tablewriter.NewWriter(w)
	if noColor {
		table.SetBorder(true)
	}
	table.SetHeader([]string{"Instance", "State"})
	for _, n := range idle {
		table.Append([]string{n, "idle"})
	}
	for _, n := range busy {
		table.Append([]string{n, "busy"})
	}
	table.Render()
	fmt.Fprintf(w, "Idle: %d  Busy: %d  Total: %d\n", len(idle), len(busy), len(idle)+len(busy))
}

func init() {
	poolCmd.AddCommand(poolStatusCmd)
}
