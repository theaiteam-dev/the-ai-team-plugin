---
model: sonnet
---
# /ai-team:review

Runs the team's code-review skill against the current branch, turns each Must Fix and Should Fix finding into a `bug`-type work item stamped with its provenance, writes a mission brief from the findings, and creates a mission — then stops, leaving execution to `/ai-team:run`. The replacement front door for `/ai-team:sweep`: unlike sweep, this command never fixes or commits anything itself, so the fixes get the full skill-loaded pipeline instead of a bare subagent.

## Usage

```
/ai-team:review
```

## Arguments

None required — operates on the current branch and current/most-recent mission automatically, mirroring `/ai-team:sweep`.

- `--quality` / `-q` (optional): override the default quality profile. One of `quick`, `normal`, `deep`. Defaults to `normal` — see Step 3.

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

## Step 2: Review

Invoke the `ai-team:code-review` skill and follow it in full: scope detection (dirty tree vs. clean, committed vs. uncommitted, no-diff cases), review subagent dispatch, severity triage (Must Fix / Should Fix / Consider), and the Parallelism Estimate.

If the skill's scope detection reports a rule failure (e.g., nothing reviewable), report why and stop — create no mission.

If the skill returns zero findings, that's a clean, complete result — report it and create no mission. Do not manufacture findings to have something to capture.

## Step 3: Create the Mission

Write a mission brief following the `mission-brief` skill — a title, an Executive Summary, a Definition of Done, and a Scope section naming the review as the evidence source. The Definition of Done statements are derived directly from the findings: each Must Fix / Should Fix finding becomes a checkbox the fix must satisfy.

Write the brief to `.mission-briefs/<slug>.md`, then create the mission with `prdPath` pointing at it. Resolve the quality profile via `resolveQualityProfile()` (`scripts/hooks/lib/qa-contract.js`) — never restate what a profile maps to inline; that single bundle definition is the whole point of the resolver. This command defaults to `normal` unless the operator passed `--quality`/`-q` with `quick` or `deep`. If `--quality`/`-q` is invalid (not one of `quick`, `normal`, `deep`), reject with a message naming all three valid names and create no mission — stop here, do not proceed. Pass the resolved contract on the invocation itself — resolving it in prose and then omitting it from the actual call would silently ship every review mission with no contract at all:

```bash
ateam missions createMission --name "Review: {branch}" --prdPath ".mission-briefs/{slug}.md" --testing-level {resolved.testing_level} --review-tier {resolved.review_tier} --profile {resolved profile name, e.g. normal} --json
```

The mission now exists — create every work item against it in Step 4, never before.

## Step 4: Map Severity and Create Work Items

The review vocabulary maps onto the item contract's `--severity` values (WI-936):

| Review severity | `--severity` |
|------------------|---------------|
| Must Fix (security, data loss, corruption) | `critical` |
| Must Fix (correctness bugs, broken tests) | `high` |
| Should Fix | `medium` |
| Consider | not captured — reported to the operator only, no work item created |

For each Must Fix and Should Fix finding, create one `bug`-type work item via `ateam items createItem`, ONE AT A TIME — never batched — carrying the full existing item contract plus the finding's provenance:

```bash
ateam items createItem \
  --title "Fix: {short finding title}" \
  --type bug \
  --priority high \
  --description "{what's wrong, tied to the finding}" \
  --objective "{one-sentence description of the fix}" \
  --acceptance "The finding no longer applies" \
  --acceptance "A regression test guards against recurrence" \
  --context "{file(s) and integration points the finding names}" \
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

Compare each finding against the returned top-50 `{fingerprint, pattern, title, hitCount}` list: if an existing fingerprint clearly describes the same recurring pattern, reuse its `fingerprint` value — this is a recurrence, not a new one. Otherwise mint a new curated slug (short, kebab-case, descriptive). Don't default to "new" just because it's less effort than checking.

**Assign `attributedAgent` by the earliest-flagged-stage convention** — see `skills/teams-messaging/SKILL.md` and `packages/shared/src/stages.ts`'s pipeline stage ordering (the same rule the retro agent uses): attribute to the agent owning the earliest pipeline stage that could have prevented the finding. Do not restate the stage-to-agent mapping here — it lives in one place already.

## Step 5: Report

Summarize for the operator: findings by severity (Must Fix / Should Fix / Consider), which work items were created and with what provenance (severity, attributedAgent, fingerprint — recurrence vs. new), the mission ID and brief path, the resolved quality profile, and the Consider items left for their discretion. If Step 1, Step 2's scope check, or a zero-findings result stopped the command early, report that outcome plainly instead — a refused mission, a scope-rule stop, and a clean review are all complete, successful runs of this command, not failures.

This command creates the mission and stops — it never fixes or commits anything itself. Leave execution to `/ai-team:run`.

## Errors

- **Mission already active**: reported and refused at Step 1 — no second mission created.
- **Code-review scope-rule failure** (e.g. nothing reviewable): reported at Step 2 — no mission created.
- **Zero findings**: reported at Step 2 as a clean, complete result — no mission created.
- **Invalid `--quality` value**: Rejected, naming `quick`, `normal`, and `deep`; no mission created.

## CLI Commands Used

| Command | Purpose |
|---------|---------|
| `ateam missions-current getCurrentMission --json` | Check for an already-active mission (Step 1) |
| `ateam missions createMission --name ... --prdPath ... --testing-level ... --review-tier ... --profile ... --json` | Create the mission with its resolved contract (Step 3) |
| `ateam items createItem` | Create each `bug`-type work item, one at a time, with severity/attributedAgent/fingerprint (Step 4) |
| `ateam learnings fingerprints --json` | Match-or-create fingerprints for created items (Step 4) |
