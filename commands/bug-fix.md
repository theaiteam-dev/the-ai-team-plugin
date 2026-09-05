---
model: sonnet
---
# /ai-team:bug-fix

Turns a reported bug into a mission — no PRD required. Accepts either a GitHub issue number or a quoted free-text description, attempts a repro, and (when successful) creates a mission holding `bug`-type work items that `/ai-team:run` executes exactly like any other mission.

## Usage

```
/ai-team:bug-fix <issue-number>
/ai-team:bug-fix "<description>"
```

Point the team at a GitHub issue or a typed description of a defect. Both forms end at the same place — a mission with a repro-derived brief and one or more `bug`-type work items — but they take different paths to get there.

## Arguments

- `<issue-number>` — a GitHub issue number (e.g. `482`). Reads the issue via the `gh` CLI and applies the closed/non-bug metadata gate before attempting a repro.
- `"<description>"` — a quoted free-text description of the bug (e.g. `"the search bar throws when the query is empty"`). No GitHub consultation, no metadata gate — goes straight to the repro attempt.
- `--quality` / `-q` (optional): override the default quality profile for this mission. One of `quick`, `normal`, `deep`. Defaults to `quick` — see Step 4.

A failing-test source flag is explicitly out of scope for this command and deferred to a later PRD.

## Pre-Flight: Environment Check

```bash
echo $ATEAM_PROJECT_ID
```

```text
if empty or "default":
    Output to user:
    "⚠ ATEAM_PROJECT_ID is not configured.
    Run /ai-team:setup to configure your project, then restart Claude Code."
    STOP.
```

## Step 1: Check for an Active Mission

Run `ateam missions-current getCurrentMission --json` before anything else. If a mission is already active, report the current mission to the operator and stop — refuse to create a second one. Unlike `/ai-team:plan`, this command never passes `--force` to `createMission`: a bug fix does not get to archive whatever the operator is already running.

## Step 2: Resolve the Input

### Issue Number Form

Read the issue via the `gh` CLI:

```bash
gh issue view {issue_number} --json state,labels,title,body,url
```

If `gh` is not installed or not authenticated, report this and stop — do not crash. Ask the operator to install the GitHub CLI or run `gh auth login`.

Apply the metadata gate: if the issue does not exist, is closed, or is not a bug (no `bug` label and no bug-type signal in the title/body), report why and create no mission — do not proceed to Step 3.

Item descriptions created from this form tie directly back to the repro captured from the issue body.

### Quoted Description Form

```bash
/ai-team:bug-fix "the search bar throws when the query is empty"
```

The quoted description form has no metadata gate at all and does not consult GitHub or the gh CLI — the agent's own repro attempt (Step 3) is the only gate, per FR-2. Repos with no GitHub issues use this form exactly the same way.

## Step 3: Attempt to Reproduce

Attempt to reproduce the defect using the fastest reliable method for this repo. If the defect cannot be reproduced, that is a valid, complete outcome (per FR-6) — report what you tried and create no mission.

Once reproduced, capture exactly what you did: the steps, the observed (wrong) behavior, and the expected behavior. This becomes the mission brief's evidence and the Definition of Done source in Step 4.

## Step 4: Create the Mission

Write a mission brief following the `mission-brief` skill — a title, an Executive Summary, a Definition of Done, and a Scope section naming the repro as the evidence source. The Definition of Done statements are derived directly from the repro: each confirmed symptom becomes a checkbox the fix must satisfy — never scaffolded blank, since a bug-fix brief already has its evidence in hand by this step.

Write the brief to `.mission-briefs/<slug>.md` per the skill's convention, then create the mission with `prdPath` pointing at it:

Resolve the quality profile via `resolveQualityProfile()` (`scripts/hooks/lib/qa-contract.js`) — never restate what a profile maps to inline; that single bundle definition is the whole point of the resolver. This command defaults to `quick` unless the operator passed `--quality`/`-q` with `normal` or `deep`. If `--quality`/`-q` is invalid (not one of `quick`, `normal`, `deep`), reject with a message naming all three valid names and create no mission — stop here, do not proceed. Pass the resolved contract on the `createMission` call itself — resolving it in prose and then omitting it from the actual invocation would silently ship every bug-fix mission with no contract at all:

```bash
ateam missions createMission --name "Bug: {short title}" --prdPath ".mission-briefs/{slug}.md" --testing-level {resolved.testing_level} --review-tier {resolved.review_tier} --profile {resolved profile name, e.g. quick} --json
```

## Step 5: Create Work Items

Create each work item ONE AT A TIME via `ateam items createItem` — never batched — using the full existing item contract so `/ai-team:run` needs no change to execute them. Bug-type items get 2-3 tests per the work-breakdown skill: reproduce the bug, verify the fix, and a regression guard.

```bash
ateam items createItem \
  --title "Fix: {short bug title}" \
  --type bug \
  --priority high \
  --description "{what's broken, tied to the repro}" \
  --objective "{one-sentence description of the fix, tied to the repro}" \
  --acceptance "The repro steps no longer reproduce the defect" \
  --acceptance "A regression test guards against recurrence" \
  --context "{integration points and files touched, from the repro investigation}" \
  --outputs.test "path/to/test/file" \
  --outputs.impl "path/to/impl/file" \
  --json
```

`--dependencies` is repeatable and does NOT split on commas — pass it once per dependency ID if a fix needs more than one item and they depend on each other.

Every item's `description` and `objective` tie back to the repro captured in Step 3 — not a generic bug template, the specific defect just reproduced. This is the exact same item contract `/ai-team:plan` already produces and `/ai-team:run` already executes — no pipeline change needed.

## Step 6: Report

Summarize for the operator: which form was used (issue or description), whether the defect was reproduced, the mission ID and brief path, the resolved quality profile, and the work item(s) created. If Step 1, Step 2's metadata gate, or Step 3's repro attempt stopped the command early, report that outcome plainly instead — a refused mission, a rejected issue, and an unreproducible defect are all complete, successful runs of this command, not failures.

## Errors

- **Mission already active**: reported and refused at Step 1 — no second mission created.
- **Issue does not exist / is closed / is not a bug**: reported at Step 2's metadata gate — no mission created.
- **`gh` not installed or not authenticated**: reported at Step 2 — no mission created, no crash.
- **Defect cannot be reproduced**: reported at Step 3 as a valid, complete outcome — no mission created.
- **Invalid `--quality` value**: Rejected, naming `quick`, `normal`, and `deep`; no mission created.

## CLI Commands Used

| Command | Purpose |
|---------|---------|
| `ateam missions-current getCurrentMission --json` | Check for an already-active mission (Step 1) |
| `gh issue view {number} --json ...` | Read a GitHub issue (Step 2, issue form only) |
| `ateam missions createMission --name ... --prdPath ... --testing-level ... --review-tier ... --profile ... --json` | Create the mission with its resolved contract (Step 4); see Step 1 for why this command never archives an existing mission |
| `ateam items createItem` | Create each `bug`-type work item, one at a time (Step 5) |
