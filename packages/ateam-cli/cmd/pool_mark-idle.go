package cmd

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"github.com/spf13/cobra"
)

var poolMarkIdleCmd_agentID string

var poolMarkIdleCmd = &cobra.Command{
	Use:   "mark-idle <instance>",
	Short: "Create a .idle marker for an instance after pre-warming",
	Long: `Creates /tmp/.ateam-pool/$ATEAM_MISSION_ID/<instance>.idle.

Used by Hannibal after a lane's agents have all sent READY, to make their
pool slots claimable. This is the post-pre-warming side of the pool
lifecycle (paired with 'pool init' at mission start).

Pass --agent-id <id> to record the instance's harness agentId as the marker
file's content. The completing agent's agentStop reads it back and returns it
as 'claimedNextAgentId' so the START handoff can address the next teammate by
agentId — friendly instance names (murdock-1, ba-2) do NOT resolve between
teammates in headless (-p) mode, so a name-addressed handoff is silently
dropped. Omitting --agent-id leaves the marker empty (falls back to
name-addressed handoff, the pre-existing behavior). Only the orchestrator,
which holds each agentId from the Agent spawn return, can supply it — an agent
cannot discover its own agentId.

Errors and refuses to act when:
  - <instance>.busy already exists (would mask a live in-flight slot — use
    'pool release' if the agent is genuinely dead)
  - <instance>.idle already exists (caller bug — double-marking hides a
    real issue, so we surface it loudly)
  - The pool dir does not exist (caller forgot 'pool init')

In --json mode the output shape is:
  { "instance": "murdock-1", "state": "idle", "agentId": "abc123", "path": "/tmp/.ateam-pool/M-.../murdock-1.idle" }`,
	Args: cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		instance := args[0]
		missionID := os.Getenv("ATEAM_MISSION_ID")
		if err := validateMissionID(missionID); err != nil {
			return err
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

		// The marker file's CONTENT is the instance's harness agentId (possibly
		// empty). agentStop.claimIdleInstance reads it back on handoff so the
		// completing agent addresses its START by agentId rather than by the
		// friendly instance name, which does not route between teammates headless.
		//
		// Publish it ATOMICALLY: write the id to a uniquely-named temp file in the
		// same directory, then rename it into place. A direct os.WriteFile would
		// make <instance>.idle visible after open+truncate but before the id bytes
		// land, so a concurrent claimIdleInstance could rename+read a partial or
		// empty id instead of the full one. Rename within a directory is atomic, so
		// .idle only ever appears complete. The temp's ".tmp" suffix keeps it out of
		// the claimer's "*.idle" glob. Mirrors the atomicity discipline in pool_claim.go.
		tmp, err := os.CreateTemp(poolDir, instance+".idle.*.tmp")
		if err != nil {
			return fmt.Errorf("create idle marker temp for %s: %w", instance, err)
		}
		tmpName := tmp.Name()
		if _, err := tmp.WriteString(poolMarkIdleCmd_agentID); err != nil {
			_ = tmp.Close()
			_ = os.Remove(tmpName)
			return fmt.Errorf("write idle marker temp %s: %w", tmpName, err)
		}
		if err := tmp.Close(); err != nil {
			_ = os.Remove(tmpName)
			return fmt.Errorf("close idle marker temp %s: %w", tmpName, err)
		}
		if err := os.Rename(tmpName, idleFile); err != nil {
			_ = os.Remove(tmpName)
			return fmt.Errorf("publish idle marker %s: %w", idleFile, err)
		}

		jsonMode, _ := cmd.Root().PersistentFlags().GetBool("json")
		if jsonMode {
			out := map[string]interface{}{
				"instance": instance,
				"state":    "idle",
				"agentId":  poolMarkIdleCmd_agentID,
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
	poolMarkIdleCmd.Flags().StringVar(&poolMarkIdleCmd_agentID, "agent-id", "", "Harness agentId to record as the marker's content, for agentId-addressed handoff")
	poolCmd.AddCommand(poolMarkIdleCmd)
}
