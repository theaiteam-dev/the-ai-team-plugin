---
model: sonnet
---
# /ai-team:bug-stomp

Turns the team loose on the current branch to hunt for defects. Investigates within scope, files each CONFIRMED defect as a `bug`-type work item with a repro description, writes a mission brief inventorying the hunt, and creates a mission — then stops, leaving execution to `/ai-team:run`. Like `/ai-team:review`, it never fixes or commits anything itself.

## Usage

```
/ai-team:bug-stomp [--paths <glob...>] [--all] [--quality <quick|normal|deep>]
```

## Arguments

None required. With no scope arguments, the hunt covers the `ai-team:code-review` skill's own default scope.

- `--paths <glob...>` (optional, repeatable): one or more globs — narrows the hunt to only the named files. Pass the flag once per glob; do not comma-split a single value.
- `--all` (optional): widens the hunt to the whole codebase, overriding the default scope.
- `--quality` / `-q` (optional): override the default quality profile. One of `quick`, `normal`, `deep`. Defaults to `normal` — see Step 4.

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

Run `ateam missions-current getCurrentMission --json` before anything else. If a mission is already active, report the current mission to the operator and stop — refuse to create a second one. This command never passes `--force` to `createMission`.

## Step 2: Resolve Scope

- **No scope arguments:** the hunt covers the `ai-team:code-review` skill's own default scope — uncommitted work when the tree is dirty, otherwise the diff against the base branch. See that skill for the exact detection logic; do not restate it here, so this command and `/ai-team:review` can never drift apart on what "default scope" means.
- **`--paths <glob...>`:** narrows the hunt to only the named files.
- **`--all`:** widens the hunt to the whole codebase, overriding the default scope.

## Step 3: Hunt

This is a hunt, not a review: investigate the branch within scope the way Amy probes (`agents/amy.md`, `skills/perspective-test/`) — actively try to break things, trace edge cases, exercise boundary conditions — not just read code looking for smells. A suspicion is not a finding: only CONFIRMED defects (reproduced or otherwise unambiguously demonstrated) become work items.

If the hunt confirms no defects, that is a clean, valid, complete outcome — report it and create no mission. Do not manufacture defects to have something to file.

## Step 4: Create the Mission

Write a mission brief following the `mission-brief` skill — a title, an Executive Summary, a Definition of Done, and a Scope section. Unlike `/ai-team:review`'s findings-only brief, this one inventories the hunt itself: what scope was covered (default/`--paths`/`--all`) and what was confirmed found. The Definition of Done statements are derived directly from the confirmed defects: each one becomes a checkbox the fix must satisfy.

Write the brief to `.mission-briefs/<slug>.md`, then create the mission with `prdPath` pointing at it. Resolve the quality profile via `resolveQualityProfile()` (`scripts/hooks/lib/qa-contract.js`) — never restate what a profile maps to inline; that single bundle definition is the whole point of the resolver. This command defaults to `normal` unless the operator passed `--quality`/`-q` with `quick` or `deep`. If `--quality`/`-q` is invalid (not one of `quick`, `normal`, `deep`), reject with a message naming all three valid names and create no mission — stop here, do not proceed. Pass the resolved contract on the invocation itself — resolving it in prose and then omitting it from the actual call would silently ship every bug-stomp mission with no contract at all:

```bash
ateam missions createMission --name "Bug stomp: {branch}" --prdPath ".mission-briefs/{slug}.md" --testing-level {resolved.testing_level} --review-tier {resolved.review_tier} --profile {resolved profile name, e.g. normal} --json
```

The mission now exists — create every work item against it in Step 5, never before.

## Step 5: File Each Confirmed Defect

The review vocabulary maps onto the item contract's `--severity` values (WI-936) — the same mapping `/ai-team:sweep` and `/ai-team:review` use:

| Finding severity | `--severity` |
|-------------------|---------------|
| Must Fix (security, data loss, corruption) | `critical` |
| Must Fix (correctness bugs, broken tests) | `high` |
| Should Fix | `medium` |

For each confirmed defect, create one `bug`-type work item via `ateam items createItem`, ONE AT A TIME — never batched — carrying the full existing item contract plus the defect's provenance and its repro:

```bash
ateam items createItem \
  --title "Fix: {short defect title}" \
  --type bug \
  --priority high \
  --description "{what's wrong and how to repro it}" \
  --objective "{one-sentence description of the fix}" \
  --acceptance "The repro steps no longer reproduce the defect" \
  --acceptance "A regression test guards against recurrence" \
  --context "{file(s) and integration points the defect touches}" \
  --outputs.test "path/to/test/file" \
  --outputs.impl "path/to/impl/file" \
  --severity "{from the table above}" \
  --attributedAgent "{from the earliest-flagged-stage convention below}" \
  --fingerprint "{matched or newly minted slug}" \
  --json
```

This is the exact same item contract `/ai-team:plan` already produces and `/ai-team:run` already executes — no pipeline change needed.

**Match-or-create against existing fingerprints.**

```bash
ateam learnings fingerprints --json
```

Compare each defect against the returned top-50 `{fingerprint, pattern, title, hitCount}` list: if an existing fingerprint clearly describes the same recurring pattern, reuse its `fingerprint` value — this is a recurrence, not a new one. Otherwise mint a new curated slug (short, kebab-case, descriptive). Don't default to "new" just because it's less effort than checking.

**Assign `attributedAgent` by the earliest-flagged-stage convention** — see `skills/teams-messaging/SKILL.md` and `packages/shared/src/stages.ts`'s pipeline stage ordering (the same rule the retro agent and `/ai-team:sweep` use): attribute to the agent owning the earliest pipeline stage that could have prevented the defect. Do not restate the stage-to-agent mapping here — it lives in one place already.

## Step 6: Report

Summarize for the operator: scope covered (default/`--paths`/`--all`), confirmed defects filed with their provenance (severity, attributedAgent, fingerprint — recurrence vs. new), the mission ID and brief path, and the resolved quality profile. If Step 1 or a clean hunt stopped the command early, report that outcome plainly instead — a refused mission and a clean hunt are both complete, successful runs of this command, not failures.

This command creates the mission and stops — it never fixes or commits anything itself. Leave execution to `/ai-team:run`.

## Errors

- **Mission already active**: reported and refused at Step 1 — no second mission created.
- **Clean hunt** (no confirmed defects): reported at Step 3 as a valid, complete outcome — no mission created.
- **Invalid `--quality` value**: Rejected, naming `quick`, `normal`, and `deep`; no mission created.

## CLI Commands Used

| Command | Purpose |
|---------|---------|
| `ateam missions-current getCurrentMission --json` | Check for an already-active mission (Step 1) |
| `ateam missions createMission --name ... --prdPath ... --testing-level ... --review-tier ... --profile ... --json` | Create the mission with its resolved contract (Step 4) |
| `ateam items createItem` | Create each `bug`-type work item, one at a time, with severity/attributedAgent/fingerprint (Step 5) |
| `ateam learnings fingerprints --json` | Match-or-create fingerprints for created items (Step 5) |
