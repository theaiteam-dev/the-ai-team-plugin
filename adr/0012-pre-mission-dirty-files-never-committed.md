# ADR 0012: Pre-mission dirty files are never committed by the pipeline, and changed ones are reported

**Status:** Accepted
**Date:** 2026-10-11
**Deciders:** Face + Sosa, decision by Josh (mission: M-20261011-001, Item Commits and Git Conventions)

## Context

Item commits are now made by the CLI, not by Tawnia reading a mission-start snapshot. The CLI needs a rule for files that were already modified or untracked when the mission started, and for the case where the mission then edits one of those files. Committing the file would put the operator's unrelated edits into a mission commit. Excluding it without a record would hide mission work.

## Decision

`ateam pool init` records a baseline: one line per dirty path (from `git status --porcelain=v1 -z --untracked-files=all`) with the `git hash-object` of its content, or `-` for a deleted file. Baseline paths are in no pipeline commit, even when the mission changes them. Tawnia lists every baseline path whose content hash changed in her commit body and DONE message as "pre-existing files changed by the mission, not committed". Plain `pool destroy` keeps the baseline and branch files so resume recovery cannot overwrite them with in-progress mission state. `pool destroy --all` removes them at mission end.

## Alternatives Considered

- Commit a changed baseline file with the item that touched it: mixes the operator's edits into mission history.
- Exclude baseline files without reporting: mission edits to them are lost from view.

## Consequences

Future missions, and the branch stored on the mission record in `mission-branch-management.md`, keep this convention: the pipeline does not commit what it did not create, and it reports what it changed but could not commit. Do not use `pool destroy --all` during resume recovery.
