---
missionId: ~
---

# Compaction Resilience

**Author:** Josh / Claude  **Date:** 2026-03-30  **Status:** Draft

## 1. Problem Statement

When Claude Code compacts Hannibal's context mid-mission, the orchestrator loses all in-memory state: which branch the mission is on, which agents are active, what pipeline stage each item is at, and what was last dispatched. The mission record in the API database has some of this (board state, activity log), but Hannibal doesn't automatically re-read it after compaction. This leads to duplicate dispatches, missed items, wrong-branch commits, and false completion reports.

During M-20260329-002, compaction fired at 04:05:07. Hannibal lost awareness of the active branch, couldn't recover context, and Tawnia committed on the wrong branch citing stale commits as mission output.

## 2. Scope

### In Scope

- `PreCompact` hook that checkpoints mission state to the API before compaction fires
- `SessionStart` hook (with `"compact"` matcher) that restores mission state after compaction
- Checkpoint data: mission ID, branch name, and timestamp (board state and activity log already queryable via API)
- API endpoint to store and retrieve compaction checkpoints
- `PostCompact` hook that logs a compaction event to the API for diagnostics
- Integration with existing mission record (extend, not duplicate)

### Out of Scope

- Preventing or delaying compaction (not possible via hooks)
- Programmatic `/compact` triggering (no API exists)
- Context utilization monitoring (no API exists)
- Changes to Claude Code's compaction behavior

## 3. Requirements

### Functional

1. A `PreCompact` hook shall fire before context compaction and POST a checkpoint to the API containing: mission ID, current branch (`git branch --show-current`), and a timestamp
2. The API shall expose `POST /api/missions/{id}/checkpoint` to store compaction checkpoints and `GET /api/missions/{id}/checkpoint` to retrieve the latest one
3. A `PostCompact` hook shall POST a compaction event to the API activity log for diagnostic visibility (observational only — cannot inject into conversation)
4. A `SessionStart` hook with `"matcher": "compact"` shall inject a restoration prompt into the conversation containing: mission ID, expected branch, and instructions to recover state from the API
5. The restoration prompt shall instruct Hannibal to: (a) verify `git branch --show-current` matches the checkpoint, (b) re-detect dispatch mode from `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` env var and reload the appropriate orchestration playbook, (c) read the board via `ateam board getBoard --json`, and (d) read recent activity via `ateam activity listActivity --json`
6. Checkpoints shall be idempotent — multiple `PreCompact` fires for the same mission shall overwrite (not append)

### Non-Functional

1. `PreCompact` hook shall complete in < 2s (compaction waits for hooks)
2. Checkpoint payload shall be < 1KB (mission ID + branch + timestamp only; board and activity queried live)
3. Restoration prompt shall be < 2000 tokens to avoid consuming recovered context budget

### Edge Cases & Error States

- API unreachable during `PreCompact`: log warning locally, proceed without checkpoint (compaction can't be blocked)
- No active mission when `PreCompact` fires: hook exits silently (no-op)
- Checkpoint exists but mission has since completed: `SessionStart` hook detects `mission.state == "completed"` and skips restoration
- Multiple compactions in rapid succession: each overwrites the previous checkpoint (latest wins)
- Branch changed between `PreCompact` and `SessionStart`: restoration prompt flags the mismatch and instructs Hannibal to check `git reflog` before proceeding

## 4. Risks & Open Questions

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| PreCompact hook fails silently | Medium | Stale/missing checkpoint | Fallback: Hannibal reads mission record + board state manually (current behavior) |
| Restoration prompt too large | Low | Wastes recovered context | Keep under 2000 tokens, reference API endpoints instead of inlining full state |
| Hook fires for non-mission sessions | Low | Wasted API call | Check `ATEAM_PROJECT_ID` env var; skip if not set |

### Resolved Questions
- **Activity log in checkpoint?** No — each work item has `work_log` and the activity feed is queryable via `ateam activity listActivity`. Restoration prompt tells Hannibal to query it live.
- **Orchestration mode in checkpoint?** No — `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` env var is set in `settings.local.json` and survives compaction. Restoration prompt tells Hannibal to re-detect and reload the playbook.
- **PostCompact as restoration fallback?** No — `PostCompact` is observational only and cannot inject text into the conversation. Used for diagnostic logging instead. `SessionStart(compact)` is the only restoration path.
