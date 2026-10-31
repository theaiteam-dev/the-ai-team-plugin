# ADR 0011: Post-move side effects in agentStop never change its exit code

**Status:** Accepted
**Date:** 2026-10-11
**Deciders:** Face + Sosa (mission: M-20261011-001, Item Commits and Git Conventions)

## Context

The item commit runs inside `agentStop` after the API has already logged the work and moved the item. The commit can still fail, for example on a branch mismatch, a missing branch file, or a git error. A non-zero exit at that point tells the agent the command failed, and the usual agent response is to run `agentStop` again. That logs the work twice, even though the move already succeeded.

## Decision

A failed item commit exits 0. The failure is reported in three places: an `itemCommit` field in the JSON response (`committed: false`, `error`), an `ITEM_COMMIT_FAILED` line on stderr telling the agent to ALERT Hannibal, and an activity-feed entry. The item stays in `staged`. Recovery goes through `ateam items-commit commitItem`.

## Alternatives Considered

- Non-zero exit: makes the failure harder to miss, but invites a repeated `agentStop` that double-logs work, after the API has already applied the state change.

## Consequences

This sets the precedent for later post-move hooks in `agentStop` and `moveItem`. The exit code reflects the API call only. A side effect that runs after the move reports failure through the JSON field, a stderr marker, and the activity feed, and has its own retry command.
