package cmd

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"github.com/spf13/cobra"
)

var poolMarkIdleCmd = &cobra.Command{
	Use:   "mark-idle <instance>",
	Short: "Create a .idle marker for an instance after pre-warming",
	Long: `Creates /tmp/.ateam-pool/$ATEAM_MISSION_ID/<instance>.idle.

Used by Hannibal after a lane's agents have all sent READY, to make their
pool slots claimable. This is the post-pre-warming side of the pool
lifecycle (paired with 'pool init' at mission start).

Errors and refuses to act when:
  - <instance>.busy already exists (would mask a live in-flight slot — use
    'pool release' if the agent is genuinely dead)
  - <instance>.idle already exists (caller bug — double-marking hides a
    real issue, so we surface it loudly)
  - The pool dir does not exist (caller forgot 'pool init')

In --json mode the output shape is:
  { "instance": "murdock-1", "state": "idle", "path": "/tmp/.ateam-pool/M-.../murdock-1.idle" }`,
	Args: cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		instance := args[0]
		missionID := os.Getenv("ATEAM_MISSION_ID")
		if missionID == "" {
			return fmt.Errorf("ATEAM_MISSION_ID is not set — pool state is per-mission")
		}
		poolDir := filepath.Join("/tmp", ".ateam-pool", missionID)

		if _, err := os.Stat(poolDir); err != nil {
			if os.IsNotExist(err) {
				return fmt.Errorf("pool dir %s does not exist — run 'ateam pool init' first", poolDir)
			}
			return fmt.Errorf("stat pool dir %s: %w", poolDir, err)
		}

		busyFile := filepath.Join(poolDir, instance+".busy")
		if _, err := os.Stat(busyFile); err == nil {
			return fmt.Errorf("%s.busy already exists — instance has a live claim; use 'ateam pool release %s' if the agent is presumed dead", instance, instance)
		} else if !os.IsNotExist(err) {
			return fmt.Errorf("stat %s: %w", busyFile, err)
		}

		idleFile := filepath.Join(poolDir, instance+".idle")
		if _, err := os.Stat(idleFile); err == nil {
			return fmt.Errorf("%s.idle already exists — refusing to double-mark; investigate why mark-idle was called twice", instance)
		} else if !os.IsNotExist(err) {
			return fmt.Errorf("stat %s: %w", idleFile, err)
		}

		f, err := os.Create(idleFile)
		if err != nil {
			return fmt.Errorf("create idle marker %s: %w", idleFile, err)
		}
		_ = f.Close()

		jsonMode, _ := cmd.Root().PersistentFlags().GetBool("json")
		if jsonMode {
			out := map[string]interface{}{
				"instance": instance,
				"state":    "idle",
				"path":     idleFile,
			}
			b, err := json.MarshalIndent(out, "", "  ")
			if err != nil {
				return err
			}
			fmt.Fprintln(cmd.OutOrStdout(), string(b))
			return nil
		}

		fmt.Fprintf(cmd.OutOrStdout(), "Marked %s idle: %s\n", instance, idleFile)
		return nil
	},
}

func init() {
	poolCmd.AddCommand(poolMarkIdleCmd)
}
