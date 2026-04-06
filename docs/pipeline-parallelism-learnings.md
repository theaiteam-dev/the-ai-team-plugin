# Pipeline Parallelism — Learnings (April 2026)

Observations and fixes from live test-harness runs as the parallel orchestration system matured.

---

## Terminology

Two distinct types of parallelism exist in the system. They were being conflated, causing confusion in agent instructions and planning discussions.

| Term | Meaning |
|------|---------|
| **Pipeline parallelism** | Different items at different stages simultaneously (assembly-line model). WI-001 in review while WI-002 is in testing. |
| **Stage concurrency** | Multiple items at the *same* stage simultaneously. Up to N items in testing at once, governed by `ateam scaling compute`. |

`instanceCount` from `ateam scaling compute` describes **how many agent instances to run per role**, not the WIP limit. The WIP limit is a separate input to the compute function.

---

## Compute Endpoint (`ateam scaling compute`)

### What it does

Returns `instanceCount = min(depGraphMax, memoryCeiling, wipLimit)` — the number of concurrent agent instances that make sense given:

- **depGraphMax**: max items that can be in-flight per stage given the dependency graph
- **memoryCeiling**: system memory headroom (free RAM ÷ per-agent estimate)
- **wipLimit**: the stage WIP limit from the database

`bindingConstraint` tells you which of the three is the bottleneck.

### What we learned

- The compute result changes over time. At mission start all WIP slots are empty, so `instanceCount` may be high (e.g. 5). Mid-mission, WIP fills and `wipLimit` becomes the binding constraint (e.g. 3).
- Pre-warm pool size should use `depGraphMaxPerStage` (structural capacity), not the live `instanceCount` which fluctuates. Or better: spawn on-demand (see below).
- `scalingRationale` is not being written back to the Mission record after compute — this is a known gap.

### CLI bug fixed

`--passed true` was being parsed as `--passed` (flag) followed by the unknown command `true`. Fixed: use `--passed` (bare = true) or `--passed=false`.

`--output` was typed as a string but the API expects an object. Fixed: the flag now accepts a JSON string and parses it before sending.

`--blockers` was always included in the request body even when nil, causing validation errors. Fixed: only sent when explicitly set.

---

## Agent Pool

### How it works

`/tmp/.ateam-pool/{missionId}/` contains empty files named `{agent}-{n}.idle` and `{agent}-{n}.busy`. Claiming a slot is an atomic `mv`:

```bash
mv "${POOL_DIR}/murdock-1.idle" "${POOL_DIR}/murdock-1.busy"   # claim
mv "${POOL_DIR}/murdock-1.busy" "${POOL_DIR}/murdock-1.idle"   # release
```

**Never `touch`, `cp`, or `rm` individual pool files.** Both `.idle` and `.busy` coexisting is a corrupted state.

### Pre-warming hits tmux pane limits

Hannibal pre-warms by spawning all N agent instances upfront via `Agent` calls. Each spawned agent creates a tmux pane. When N=5, hitting the tmux pane limit causes some instances to fail silently — the pool slot exists but no agent is behind it.

**The right model**: create the pool *files* upfront (so Hannibal knows slot count), but spawn agents **on-demand** at dispatch time. No tmux panes consumed for idle instances. This is the planned fix but not yet implemented.

### Tawnia cleans up the pool

At mission end, Tawnia removes `/tmp/.ateam-pool/${MISSION_ID}/` as part of the final commit step. Hannibal should not be responsible for this.

---

## Rejection Flow

### What was broken

`rejectItem` only accepted items in `review` stage. Amy's FLAG path left items in `probing`, then Hannibal called `rejectItem`, got `INVALID_STAGE`, fell back to `board-move → ready`, and re-dispatched the full pipeline including Murdock — even though the bug was in the implementation, not the tests.

One item (WI-108) cycled through the pipeline 3 times this way, adding ~20 minutes to wall time.

### What was fixed

`rejectItem` CLI command and API route are **removed**. Rejection is now a first-class outcome of `agentStop`:

```bash
# Lynch — bad tests
ateam agents-stop agentStop --itemId WI-007 --agent Lynch \
  --outcome rejected --return-to testing \
  --summary "REJECTED - AC has no test"

# Lynch — bad impl
ateam agents-stop agentStop --itemId WI-007 --agent Lynch \
  --outcome rejected --return-to implementing \
  --summary "REJECTED - null case unhandled"

# Amy — code bug (FLAG)
ateam agents-stop agentStop --itemId WI-007 --agent Amy \
  --outcome rejected --return-to implementing \
  --summary "FLAG - crashes on plain-text error body"
```

The API handles: `rejectionCount++`, escalation to `blocked` after 2 rejections, stage move to `returnTo`.

In native teams mode, Lynch and Amy then send `START` directly to the appropriate agent (Murdock for test issues, B.A. for impl/bug issues). Hannibal receives FYI only and does not re-dispatch unless he gets ALERT.

---

## Skills Architecture

Repeated instructions shared across multiple agents were extracted into skills:

| Skill | Replaces |
|-------|---------|
| `pool-handoff` | Inline pool claiming instructions in every agent |
| `teams-messaging` | Inline message format templates in every agent |
| `agent-lifecycle` | Inline `agentStop` and activity logging patterns |
| `work-breakdown` | Inline item type/sizing/field rules in Face and Sosa |
| `ateam-cli` | `--json` flag rules added; inline CLI notes in agents |

Agents reference skills with a trigger sentence: "Consult the `skill-name` skill for X." The skill is loaded at agent startup via the `skills:` frontmatter array.

### `--json` flag rule

Any `ateam` command whose output is piped or captured **must** include `--json`. Without it, the CLI outputs a formatted table that breaks `json.load()` and similar parsers.

---

## Stockwell Git Diff

`git diff main...HEAD` only shows commits that haven't been merged to main. On branches that diverged early, or when the working tree has uncommitted changes, this missed files.

Fixed to: `git add -N . && git diff HEAD` — captures all tracked and untracked (intent-added) changes in the working tree.

---

## Hannibal Visibility Gap

When 5 agents fire simultaneously and tmux pane limits are hit, some agents fail to start. Hannibal dispatches and then waits for FYI/ALERT messages that never come. He goes quiet, not knowing whether work is happening.

Current mitigation: Hannibal does a liveness check reactively on ALERT. Gap: no proactive polling when idle with items in-flight.

Planned fix: if Hannibal has been idle for >5 minutes with items in `testing`/`implementing`/`review`/`probing`, poll the board and reconcile any stale `assignedAgent` values.

---

## Wall Time Observations

| Run | Wall Time | Notes |
|-----|-----------|-------|
| M-20260403-001 | 52.2 min | 2-agent pool, no compute call, sequential B.A. |
| M-20260404-003 | 87.7 min | 5-agent pool, broken rejection flow caused WI-108 to cycle 3× |
| M-20260404-004 | in progress | 5-agent pool, fixed rejection flow, 5 Murdocks fired simultaneously on Wave 0 unlock |

The 68% regression in M-20260404-003 was entirely due to the rejection loop bug. The underlying parallelism was working — throughput just got eaten by repeated pipeline re-runs of the same item.
