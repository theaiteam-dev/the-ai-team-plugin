# ADR 0010: Pipeline git writes live in the CLI, not in agent prompts

**Status:** Accepted
**Date:** 2026-10-11
**Deciders:** Face + Sosa (mission: M-20261011-001, Item Commits and Git Conventions)

## Context

The item-commits PRD commits each work item when it reaches `staged`. That commit had to be impossible for an agent to skip. A prompt instruction depends on every agent following it on every run, and both Amy (`agentStop`) and Hannibal (`board-move moveItem`) move items to `staged`.

## Decision

`ateam agents-stop agentStop` and `ateam board-move moveItem` make the item commit themselves, after the API confirms the move to `staged`. Agents never run the commit. They only relay a failure (ITEM_COMMIT_FAILED) to Hannibal.

## Alternatives Considered

- A commit step in Amy's and Hannibal's prompts: skippable, and duplicated across two prompts and two dispatch modes.
- A server-side commit from the API: the API does not have the working tree. In the hosted and Docker setups it runs in a different filesystem than the repo.

## Consequences

Later git-side features (tags, branch creation at plan time from `mission-branch-management.md`, branch guards) go in the CLI and run after an API-confirmed state change. They are not added as prompt steps. Agent prompts carry only the failure-relay instructions.
