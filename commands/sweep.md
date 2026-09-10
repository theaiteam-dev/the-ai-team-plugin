---
model: sonnet
---
# /ai-team:sweep

**Retired.** Use `/ai-team:review` instead, which creates a mission from the branch's findings rather than autofixing and committing directly.

## Usage

```text
/ai-team:sweep
```

## Behavior

Running this command prints the pointer below and stops — nothing else happens. It does not review the branch, does not capture any findings, does not fix anything, and does not run `/ai-team:review` on your behalf; run that command yourself.

```text
⚠ /ai-team:sweep has been retired.

Use /ai-team:review instead — it turns what an independent branch review
finds into a mission with typed work items, so fixes run through the
normal pipeline (tests, review, probing) instead of a bare subagent
autofixing and committing directly.

STOP.
```

## Why This Command Changed

`/ai-team:sweep` used to review, fix, and commit in one shot with no board visibility and no attributable telemetry. `/ai-team:review` (its replacement) runs the same kind of independent review but files each Must Fix / Should Fix finding as a real, typed work item — carrying its severity, attributed agent, and fingerprint — under a mission the normal pipeline executes. This command is kept as a signpost for one release; a future release removes it entirely.
