---
missionId: ~
---

# Mission Branch Management

**Author:** Josh / Claude  **Date:** 2026-03-29  **Status:** Draft

## 1. Context & Background

The A(i)-Team pipeline runs multiple agents concurrently on a shared working directory. All agents — Murdock, B.A., Lynch, Amy, Stockwell, Tawnia — read and write files in the same git repository. There is currently no mechanism to isolate a mission's work onto a dedicated branch, nor any way for agents to verify they are operating on the correct branch.

This became critical during the test-harness mission (M-20260329-002) when Stockwell ran `git stash && rm -rf client/ && git checkout pass-1` during a "read-only" final review, switching the entire working directory to a stale branch and destroying uncommitted mission work. When context compaction then fired, Hannibal lost all memory of which branch the session had been on, and Tawnia committed on the wrong branch citing yesterday's commits as the mission output.

The combination of shared mutable state (git working tree), no branch isolation, and no durable branch tracking makes missions fragile. Any agent can accidentally or intentionally switch branches, and compaction erases the evidence.

## 2. Problem Statement

Missions have no dedicated branch and no durable record of which branch they operate on. Agents share a single working tree with no guard against branch switching. When context compaction occurs, the orchestrator loses branch state entirely, leading to commits on wrong branches, lost work, and false completion reports.

## 3. Target Users & Use Cases

**Primary users:**
- **Hannibal (orchestrator)** — needs to verify agents are on the correct branch, especially after compaction
- **Pipeline agents (Murdock, B.A., Lynch, Amy, Stockwell, Tawnia)** — need a known branch to commit to and verify against
- **Human operator** — needs clean branch history per mission for PR review and rollback

**Key use cases:**
- Operator runs `/ai-team:plan` and the mission gets a dedicated `feat/{prdName}` branch created automatically
- After context compaction, Hannibal reads the mission record to recover the branch name and verifies `git branch --show-current` matches
- An agent attempts to switch branches and is either blocked by enforcement hooks or detected by a branch verification check
- Operator creates a PR from the mission branch after completion, with a clean diff against main
- Multiple missions on separate branches can coexist without interfering

## 4. Goals & Success Metrics

| Goal | Metric | Target |
|------|--------|--------|
| Eliminate wrong-branch commits | Commits on unintended branches during missions | 0 |
| Survive compaction | Branch state recoverable after context compaction | 100% |
| Clean PR workflow | Each mission produces a single feature branch for PR | Every mission |

## 5. Scope

### In Scope

- Branch creation during `/ai-team:plan` (`feat/{prdName}` format)
- Storing branch name in the Mission database record
- Branch verification at mission start (`/ai-team:run`) and after compaction recovery
- Updating agent dispatch prompts to include expected branch name
- Branch verification hook or check that agents can use to confirm they're on the correct branch
- Tawnia commits on the mission branch (not main)

### Out of Scope

- Automatic PR creation (operator decision)
- Branch protection rules or merge policies (git hosting concern)
- Per-agent worktrees or filesystem isolation (platform limitation)
- Automatic merge to main after mission completion
- Branch cleanup after mission archival

## 6. Requirements

### Functional

1. `/ai-team:plan` shall create a new git branch named `feat/{prdName}` from the current HEAD when initializing a mission, where `{prdName}` is derived from the PRD filename (kebab-case, without extension)
2. If the branch already exists (e.g., from a previous failed mission), `/ai-team:plan` shall ask the operator whether to reuse it or create a fresh branch
3. The Mission record in the API database shall include a `branch` field (string, nullable) storing the mission's branch name
4. `ateam missions createMission` shall accept an optional `--branch` flag to store the branch name
5. `ateam missions-current getCurrentMission` shall return the `branch` field in its response
6. `/ai-team:run` shall verify `git branch --show-current` matches the mission's stored branch before starting the pipeline; if mismatched, it shall checkout the correct branch (or error if dirty)
7. After context compaction, Hannibal shall read the mission record to recover the branch name and verify the working directory is on the correct branch before resuming
8. Agent dispatch prompts shall include the expected branch name: "You are working on branch `{branch}`. Do not switch branches."
9. Tawnia shall commit on the mission branch, not on main
10. The branch name shall be included in activity log entries at mission start and after compaction recovery

### Non-Functional

1. Branch creation shall add < 1s to `/ai-team:plan` execution time
2. Branch verification shall add < 500ms to `/ai-team:run` startup
3. The `branch` field shall be nullable to maintain backward compatibility with existing missions that have no branch

### Edge Cases & Error States

- Mission started from a detached HEAD: branch creation shall work normally (creates branch from current commit)
- Uncommitted changes in working tree at plan time: warn the operator and suggest committing or stashing before branching
- Branch name collision with an existing remote branch: append a short suffix (e.g., `feat/{prdName}-2`)
- Agent switches branch mid-mission (Stockwell scenario): enforcement hooks should block `git checkout`/`git switch` commands during active missions; if not blocked, branch verification at next orchestration cycle detects the mismatch
- PRD filename contains characters invalid for git branch names: sanitize to alphanumeric, hyphens, and slashes only

## 10. Risks & Open Questions

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Agent bypasses branch check via direct git commands | Medium | High (wrong-branch work) | Enforcement hook blocks `git checkout`/`git switch` during missions |
| Compaction loses branch context before mission record is read | Low | Medium (manual recovery) | Branch stored in API DB, not conversation context |
| Branch name conflicts in multi-mission scenarios | Low | Low (operator intervention) | Suffix strategy for collisions |

### Open Questions
- [ ] Should `git checkout` and `git switch` be blocked entirely for all agents during a mission, or only for non-Hannibal agents?
- [ ] Should the branch be created from `main` (clean base) or from current HEAD (preserves any local setup)?
- [ ] When a mission is archived, should the branch be deleted automatically, or left for the operator?
