---
model: sonnet
---
# /ai-team:sweep

One-shot post-mission sweep: review the branch against `main`, capture confirmed findings as `RetroLearning` rows, then fix them and commit.

This automates the operator habit of running a code review after every mission and hand-filing what it finds. It is **operator-initiated** — it is not part of the mission pipeline and Hannibal never dispatches it. The Debrief (retro agent) remains a pattern-miner over surfaces that already exist; the sweep is the independent, cold-eyes reviewer that produces one of those surfaces.

## Usage

```
/ai-team:sweep
```

## Arguments

None. Operates on the current branch and current/most-recent mission automatically.

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

## Step 1: Review

Invoke the `ai-team:code-review` skill and follow it in full: scope detection (branch vs base, committed vs uncommitted), review subagent dispatch, severity triage (Must Fix / Should Fix / Consider), and the Parallelism Estimate.

If the skill reports nothing to review, or the review returns zero findings, say so plainly and stop — **a clean sweep is a valid, complete outcome.** Do not manufacture findings to have something to capture.

Log the sweep for telemetry:

```bash
ateam activity createActivityEntry --agent sweep --message "Sweep review complete: {N} Must Fix, {M} Should Fix, {K} Consider" --level info
```

## Step 2: Capture

Capture **Must Fix and Should Fix** findings as `RetroLearning` rows. Consider-level findings are reported to the operator but never captured or auto-fixed — filing style nits as learnings buries the signal.

**a. Resolve the mission.** Run `ateam missions-current getCurrentMission --json`. If no current mission (already archived), identify the mission this branch's work belongs to from the branch's commit messages (mission IDs appear in commit bodies, e.g. `Mission M-20260702-001`). If genuinely unresolvable, omit `--missionId` — rows without a mission are valid (the backfill corpus works the same way).

**b. Map severity.** The review vocabulary maps onto `RetroLearning` severity at this boundary:

| Review severity | `--severity` |
|-----------------|--------------|
| Must Fix (security, data loss, corruption) | `critical` |
| Must Fix (correctness bugs, broken tests) | `high` |
| Should Fix | `medium` |
| Consider | not captured |

**c. Match-or-create against existing fingerprints.**

```bash
ateam learnings fingerprints --json
```

Compare each finding against the returned top-50 `{fingerprint, pattern, title, hitCount}` list:
- If an existing fingerprint clearly describes the same recurring pattern, reuse its `fingerprint` and `pattern` — this is a recurrence, not a new learning.
- Otherwise, mint a new curated slug (short, kebab-case, descriptive). Don't default to "new" just because it's less effort than checking.

**d. Assign `attributedAgent` by the earliest-flagged-stage convention** (same rule as the retro agent): attribute to the agent owning the *earliest* pipeline stage that could have prevented the finding — a test coverage gap → `murdock`; an implementation bug → `ba`; something a per-feature review should have caught → `lynch`; a missed probe category → `amy`; a cross-cutting issue only visible at whole-branch scope → `stockwell`. (Deliberately narrower than the retro agent's set: a diff review cannot see orchestration/dispatch defects, so `hannibal` attribution never arises here.)

**e. Emit each row:**

```bash
ateam learnings create \
  --source "code-review" \
  --severity "{from step b}" \
  --attributedAgent "{from step d}" \
  --targetSurface "{file the fix touches}" \
  --pattern "{fingerprint slug — matched or newly minted}" \
  --fingerprint "{same slug as --pattern unless you have a reason to diverge}" \
  --title "{short title}" \
  --detail "{normalized description}" \
  --missionId "{from step a, omit if unresolved}"
```

**`detail` is a normalized description, never a secret or a raw diff.** Describe the shape of the problem in your own words — never paste credentials, tokens, environment variable values, or verbatim diff/code blocks.

Record the returned row IDs — the fix commit references them.

**Captured rows stay `status: open` even after Step 3 fixes them — this is intentional.** Phase 1 has no `ateam learnings` mutate command; resolution is a tuning-round event (Phase 2). A sweep-fixed finding will therefore still appear in `ateam learnings rank` until a tuning round resolves it. Do not treat that as an error, and do not try to work around it.

## Step 3: Autofix

**Precondition: clean working tree.** If there are uncommitted changes (i.e., Step 1 reviewed uncommitted work), stop after capture and present the findings — do not mix autofix commits into the operator's work in progress.

Use the review's **Parallelism Estimate** (Must Fix + Should Fix grouping) as the dispatch plan: one fix subagent per independent group, dispatched concurrently via the Task tool (`clean-code-architect` if available in your agent types, otherwise `general-purpose`). Each fix agent must:

1. **TDD where the bug is testable**: first add or extend a test that fails on the current code and proves the finding, then fix until green. Non-behavioral findings (e.g., trimming an over-broad query projection) may be fixed directly.
2. **Never weaken an existing test** to make a fix pass, and never delete or skip tests.
3. Run the test suites covering its touched files and report results honestly.

After all fix agents complete, run the affected packages' test suites yourself to confirm green, then make **one commit** for the whole sweep:

```
fix({scope}): {one-line summary of the sweep's fixes}

Post-mission code review of {mission or branch description} surfaced
{N} findings, now fixed and captured as RetroLearning rows (ids {X-Y}):

- {finding 1: what was wrong, what the fix does}
- {finding 2: ...}
```

If a finding turns out to be a false positive during fixing (the fix agent proves the flagged behavior is actually correct), do not force a change: leave the code alone, note the outcome in the final report, and leave the captured row in place — the Debrief/tuning rounds handle downgrades; the sweep does not delete learnings.

Findings the operator should decide on (genuine trade-offs, scope questions) are **reported, not fixed** — the sweep fixes defects, it does not make design decisions.

## Step 4: Report

Close with:

```bash
ateam activity createActivityEntry --agent sweep --message "Sweep complete: {N} findings captured (rows {X-Y}), {M} fixed in {commit sha}, {K} reported only" --level info
```

Then summarize for the operator: findings by severity, which rows were created (recurrences vs new fingerprints), what was fixed and committed, what was left as reported-only and why, and the Consider items for their discretion.
