---
missionId: ~
---

# Item Commits and Git Conventions

**Author:** Josh / Claude  **Date:** 2026-10-10  **Status:** Ready

## Executive Summary

A mission's work currently reaches git as one commit that Tawnia makes at the end, so a mission PR is one large diff. Nitpick reviews large diffs worse: past 40 reviewer children it merges shards above the size its model was tested at and reports the review as `DEGRADED`. This PRD commits each work item when it reaches `staged`, with trailers that name the item, the mission, and the PRD. The mission branch then records which lanes built which item and what the item looked like during the run. Tools outside the pipeline (Nitpick, Shakedown) can find a mission's footprint from git alone, including after a squash merge.

## Definition of Done

- [ ] In the sandbox from `scripts/qa/item-commits-sandbox.sh`, after items are moved to `staged` with the branch-built CLI, `git log` shows one commit per item that reached `staged`, each containing only that item's attributed paths, with `Item:`, `Mission:`, `PRD:`, and `Lanes:` trailers and no `Co-authored-by` line.
- [ ] Each item commit's subject is the item's type prefix (`feat`, `fix`, `chore`) followed by the item's title exactly as it appears on the board.
- [ ] An item that was reworked shows its lanes in order in the `Lanes:` trailer, with repeats for each pass (for example `Lanes: murdock-2 ba-1 lynch-1 ba-4 lynch-3 amy-2`).
- [ ] A reworked item gets a new commit on its return to `staged` with the same `Item:` trailer; its earlier commit is still in the log unchanged, and the item on the board shows the latest SHA.
- [ ] Files that were dirty before the mission started, and files declared by another item that has not reached `staged`, are never in an item's commit.
- [ ] A changed file no item declares (a route index, an app shell, shared config) appears in the commit of the first item to reach `staged` after it changed, and that commit's body lists it as an undeclared path.
- [ ] An item that reaches `staged` with no file changes produces no commit, and its work log on the board says why.
- [ ] Two items reaching `staged` at the same moment both get their commits; neither fails on git's index lock.
- [ ] In the sandbox, after `git switch -c other`, staging an item with `agentStop` produces no commit: the item stays in `staged`, the command's stderr prints an `ITEM_COMMIT_FAILED` line that tells the agent to ALERT Hannibal, the JSON shows `itemCommit.committed: false`, and the activity feed on :5567 shows the failure.
- [ ] After fixing the cause of a failed item commit, the operator can commit that item with one CLI command without moving it out of `staged`.
- [ ] In the sandbox, an item that reaches `staged` through `agentStop` (native path) and another that reaches `staged` through `board-move moveItem --toStage staged` (the legacy path Hannibal uses) both get item commits, and the legacy playbook runs `ateam pool init` at mission start.
- [ ] Tawnia's end-of-mission commit contains only docs, the evidence bundle, graduated specs under `specs/<prd-slug>/`, and leftover unattributed changes listed by path. It contains no item code and ends with `Mission:` and `PRD:` trailers.
- [ ] In the sandbox, `ateam missions-pr openDraft` pushes to the sandbox's bare remote and calls the stub `gh` with `pr create --draft --body-file <path>`, never `pr ready` or `pr merge`. With no remote, with `gh auth status` failing, or with `pullRequest.open: false`, it opens nothing and prints the description file path and the exact `gh pr create` command.
- [ ] Squashing the sandbox branch into the sandbox's main with the generated PR description as the message, plus two `Co-authored-by:` lines appended, leaves `git interpret-trailers --parse` returning the `Mission:` and `PRD:` trailers. A real GitHub squash merge is checked by the operator when this PR merges, not by Frankie.
- [ ] The operator docs name the GitHub setting ("Default commit message: Pull request title and description") that keeps the trailers through a squash merge.
- [ ] A file that was dirty before the mission and was then changed by the mission is in no commit, and Tawnia's commit body and DONE message list it by path.

## 2. Problem Statement

Lynch and Amy review each work item as a separate unit, but git loses those boundaries. Tawnia's single end-of-mission commit puts every item's code, tests, docs, and evidence into one change. Nitpick cannot review that change in pieces, and its review degrades as the change grows. Nothing in git links code back to the item, mission, or PRD that produced it. Tools that run in GitHub Actions have no database, so git and GitHub are the only places they can look.

## 5. Scope

### In Scope

- A commit for each work item, made when the item reaches `staged`
- A new commit each time a reworked item returns to `staged` (after a Frankie, Stockwell, or manual move back)
- Trailers on every mission commit: `Item:`, `Mission:`, `PRD:`
- Recording which lanes worked the item, in order, in its commit
- Tawnia's end-of-mission commit narrowed to docs, the evidence bundle, graduated specs, and anything not attributed to an item
- Frankie's graduated FlowSpecs placed in a directory named for the PRD slug
- A PR description, written by the pipeline, that ends with the mission's trailers, so the trailers survive a squash merge
- A draft PR opened by the pipeline at the end of the mission, with a per-repo off switch
- A branch check that stops item commits from landing on any branch other than the one the mission started on
- Recording each item's commit SHA on the item (extends `commit-provenance.md`, whose goal 2 assumed one commit per mission)

### Out of Scope

- Marking the PR ready for review or merging it (stays an operator action)
- The rest of `mission-branch-management.md`: creating a branch at plan time, storing the branch on the mission record, and blocking `git checkout`/`git switch`. That PRD stays separate. Its stored branch replaces this PRD's local branch file when it ships.
- Changes to Nitpick or Shakedown. They get goal-level issues in their own repos.
- Feature flags, merging items to main individually, or moving the mission tail to a release gate. These are deferred until a month of item-commit reviews shows whether they are needed.
- Rewriting history on the mission branch (no rebasing, squashing, or amending of item commits during a mission)
- Backfilling trailers on past missions

## 6. Requirements

### Functional Requirements

1. When a work item reaches `staged`, the `ateam` CLI shall create one commit containing that item's changes, after the API confirms the move. This applies to `agentStop` when the item advances to `staged` and to `board-move moveItem --toStage staged`. No agent prompt carries this step.
2. An item commit shall contain only paths attributable to that item: its declared outputs and any undeclared files assigned to it under requirement 4.
3. Files outside the item's attribution shall stay uncommitted, even if they are modified in the working tree at that moment.
4. A modified file that no item declares (route indexes, app shells, shared config) shall be committed with the first item that reaches `staged` after the file changed. Changes left at the end of the mission shall go into Tawnia's commit and be listed there by path.
5. When an item returns to `staged` after rework, the pipeline shall create a new commit with the same `Item:` trailer. Earlier item commits shall never be amended.
6. Every commit the pipeline makes shall end with these trailers:
   - `Item: WI-NNN` (item commits only)
   - `Mission: M-YYYYMMDD-NNN`
   - `PRD: <prd-slug>`, where the slug is the PRD filename without its extension
7. Each item commit shall carry a `Lanes:` trailer listing, in order, every agent instance that worked the item, taken from the item's work log. Rework shows as repeats: `Lanes: murdock-2 ba-1 lynch-1 ba-4 lynch-3 amy-2`. Item commits shall not use `Co-authored-by`, so squash commits don't collect one line per instance. Tawnia's commit keeps its existing per-role `Co-authored-by` lines.
8. An item commit's subject line shall use the item's type as its Conventional Commits prefix (`feat`, `fix`, `chore`) and its title from the API, never a paraphrase.
9. Tawnia's end-of-mission commit shall contain documentation, the evidence bundle, graduated specs, and the unattributed changes from requirement 4. It shall not re-commit item code.
10. Frankie shall write graduated FlowSpecs under `specs/<prd-slug>/`.
11. At the end of the mission, the pipeline shall write a PR title and description: a summary, the list of items with their commit SHAs, Frankie's checklist when Frankie ran, and the `Mission:` and `PRD:` trailers as the final paragraph.
12. The PR description shall be written to a known file. Tawnia shall then push the mission branch and open a **draft** PR with that file as its body, when the repo has a remote and `gh` is authenticated. When either is missing, or the repo's `ateam.config.json` turns PR opening off, Tawnia shall report the file path and the exact `gh pr create` command instead. Tawnia shall never mark the PR ready or merge it.
13. Each item's commit SHA shall be recorded on the item. When an item has several commits because of rework, the latest SHA is the one recorded.
14. The PRD slug shall be the single identifier used for the `PRD:` trailer, the specs directory, and the PRD file itself.

### Non-Functional Requirements

1. Creating an item commit shall not block or delay other lanes' work beyond the time git needs to write the commit.
2. Item commits shall be created only on the mission's branch. At mission start, `ateam pool init` shall record the current branch in the mission's pool directory (`/tmp/.ateam-pool/<missionId>/`). Before each item commit, the CLI shall compare the current branch to the recorded one, and on a mismatch the commit shall fail loudly and the item shall not be reported as committed. When `mission-branch-management.md` ships, the branch stored on the mission replaces this file.
3. Two items can reach `staged` at the same moment. Concurrent item commits shall not fail because of git's index lock: the CLI shall serialize them or retry.
4. The CLI shall run git against the repository root, whatever the calling agent's working directory is.
5. A commit failure shall not move the item backward or lose its changes. The item stays in `staged`, the failure is logged to the activity feed, and Hannibal receives an ALERT.
6. Repos that squash merge shall keep the `Mission:` and `PRD:` trailers on main when the squash message uses the PR description. The operator docs shall state the GitHub setting this needs ("Default commit message: Pull request title and description").

### Edge Cases & Error States

- **Shared-file chains.** Items that edit the same file are serialized through `parallel_group`, so when an item reaches `staged`, the file holds exactly that item's changes on top of the earlier items' committed ones. The commit takes the whole file.
- **Two concurrent items touch the same undeclared file.** Requirement 4 assigns it to whichever item reaches `staged` first, so that commit can include another in-flight item's partial edit. The commit shall list undeclared paths it included, so a reviewer can see the assignment.
- **An item reaches `staged` with no file changes** (a no-op task, or work already done by an earlier item). No commit is created, and the item's work log records why.
- **An item is moved to `blocked`.** Nothing is committed. If it later reaches `staged`, it commits then.
- **NO_TEST_NEEDED task items** commit like any other item. Their commit simply has no test file.
- **Pre-existing dirty files** from before the mission started are never committed. This keeps the same rule Tawnia already follows.
- **The mission is abandoned partway.** Item commits already made stay on the mission branch. Nothing is rolled back automatically.
- **GitHub adds `Co-authored-by` lines to a squash commit.** These must not break trailer parsing of `Mission:` and `PRD:`. Verify against a real squash merge before calling the squash requirement done.

## 10. Risks & Open Questions

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| A commit lands on the wrong branch | Medium | High: mission work spread across branches | Branch file recorded at `pool init`, checked before every commit (non-functional requirement 2) |
| The branch file is lost (reboot, `/tmp` cleanup) mid-mission | Low | Medium: commits blocked until restored | Fail loudly with the fix: write the branch name into the file by hand, or re-run `pool init`, which records the branch only. The pool markers in the same directory have the same exposure today. |
| The baseline file is lost (reboot, `/tmp` cleanup) mid-mission | Low | High: re-recording from the current worktree would treat pending mission changes as pre-existing, excluding them from item commits and from Tawnia's final commit | Never re-record mid-mission. `pool init` refuses to write a new baseline when the branch already has a commit with this mission's `Mission:` trailer, warns, and exits 0. Item commits refuse to run without the file. The operator restores `baseline-dirty` by hand from the mission-start `git status`. Remaining gap: before the first item commit there is nothing to detect, so a wipe in that window must also be restored by hand before re-running `pool init`. |
| An undeclared-file assignment puts one item's partial edit in another item's commit | Medium | Low: history is slightly wrong, the code is not | List included undeclared paths in the commit (edge cases) |
| git index lock contention when two items commit at once, or an agent is running git | Low | Low: one delayed commit | Non-functional requirement 3 |
| The draft PR triggers a Nitpick review as soon as Tawnia finishes | High | Low: this is intended, but costs a review per mission | Deliberate. Nitpick's trigger includes `opened`, which fires for drafts. Repos that don't want this can turn PR opening off. |
| Per-item commits don't improve Nitpick reviews, because Nitpick doesn't use commit boundaries yet | High until queso/nitpick-flow#26 ships | Medium | The PRD still pays off in history and provenance. nitpick-flow#26 tracks the review side. |

### Decisions (2026-10-11)

- **The CLI makes the item commit**, inside `agentStop` and `moveItem`, so no agent can skip it.
- **Branch safety uses a local branch file** written by `pool init`. `mission-branch-management.md` stays a separate PRD.
- **Lanes are recorded in one ordered `Lanes:` trailer**, not `Co-authored-by`.
- **Tawnia opens a draft PR** with the generated description, with an off switch in `ateam.config.json`.
