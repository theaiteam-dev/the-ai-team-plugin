# Frankie — Walk 3 CLI Transcript

**Mission:** M-20260815-001 · **Walked:** 2026-08-16 (third walk)
**Target:** local managed QA server `http://localhost:5567` (`npm run dev:qa`,
fresh `qa.db` wiped + migrated + seeded on every start).
All `ateam` calls below carry `--base-url http://localhost:5567`; the flag is
elided in the excerpts for readability.

The live orchestration API (`kanban.theaiteam.dev`) has **not** deployed this
mission's code and was deliberately not used to judge staged-stage behaviour.

---

## §0 — Environment

```
$ curl -s -o /dev/null -w "%{http_code}" http://localhost:5567
200
```

Seeded stage set (from `dev:qa` startup):

```
Briefings (order 0, WIP unlimited)   Ready (1, 10)     Testing (2, 3)
Implementing (3, 3)                  Probing (4, 3)    Review (5, 3)
Staged (6, unlimited)                Done (7, unlim)   Blocked (8, unlim)
```

`Staged` carries no WIP limit — PRD requirement 9 (WIP exemption).

---

## §1 — DoD 1: all-staged trigger, nothing in `done`

`probing → done` is closed; `probing → staged` is the pipeline's terminal
transition. Driven on WI-001:

```
$ ateam board-move moveItem --itemId WI-001 --toStage done
Error: INVALID_TRANSITION: Invalid transition from probing to done

$ ateam board-move moveItem --itemId WI-001 --toStage staged
success: True stageId: staged
```

No item can reach `done` through the per-item pipeline at all, so the
"without any item having entered `done`" clause holds by construction.

Stop-hook gate driven against a 2-staged / 0-done board:

```
countBoard -> {"totalActive":0,"doneCount":0,"stagedCount":2}

checkFrankieEvidence({stagedCount: 2}) ->
  STOP: Frankie's evidence bundle is missing. Expected:
  .qa-evidence/M-NOPE-999/report.md. Dispatch Frankie to walk the mission DoD
  before the Final Mission Review can proceed. If Frankie cannot run in this
  environment (no Playwright headless shell, no flowspec, dev server
  unavailable), re-run with ATEAM_SKIP_FRANKIE_GATE=1 to override this gate.

checkFrankieEvidence({stagedCount: 0}) -> null      (silent, as required)

checkStagedNotPromoted(2) ->
  STOP: 2 item(s) remain staged, not yet promoted to done. Promotion runs
  automatically inside the same transaction that persists Stockwell's Final
  Mission Review once its verdict is FINAL APPROVED [...] The mission cannot
  stop while items sit in staged.

checkStagedNotPromoted(0) -> null                   (silent, as required)
```

---

## §2 — DoD 2: tail rework through pipeline mechanics alone

### 2a — the two rework routes, rejection-cap counted

Both are ordinary `board-move` calls — no `--force`, no direct DB edit, no
manual reopen:

```
WI-003 before:            stage=staged        rejectionCount=0
staged -> implementing    stage=implementing  rejectionCount=1
(forward back to staged)  stage=staged        rejectionCount=1   # no increment
staged -> testing         stage=testing       rejectionCount=2
```

Work log, attributed to Hannibal as a first-class `tail_rework` action:

```
Amy      | started     | Started work on item
Amy      | completed   | VERIFIED - Frankie DoD walk fixture probe
Hannibal | tail_rework | Tail rework: moved from staged to implementing
Hannibal | tail_rework | Tail rework: moved from staged to testing
```

### 2b — the instruction text that failed on walk 1 (WI-791)

Both messages an orchestrator actually reads at a tail failure were re-driven.
Both prescribe the real transition and a reachable restart condition:

```
checkFrankieEvidence (failed-walk branch) ->
  STOP: Frankie's walk FAILED. .qa-evidence/<mission>/report.md contains
  failing DoD statements. Do NOT dispatch Stockwell for the Final Mission
  Review. For each failing item, move it out of staged to testing or
  implementing using the earliest-flagged-stage rule (WI-794) — a real,
  rejection-cap-counted transition, not a manual reopen (done is terminal,
  ADR 0005; items here are still in staged, never done). Once the named items
  are reworked and back in staged, dispatch Frankie to re-walk the FULL
  Definition of Done. [...]

checkFinalReviewRejection (FINAL REJECTED) ->
  STOP: Stockwell's Final Mission Review verdict is FINAL REJECTED. Do NOT run
  post-checks and do NOT dispatch Tawnia. For each item Stockwell named, move
  it out of staged to testing or implementing using the earliest-flagged-stage
  rule (WI-794) — a real, rejection-cap-counted transition, not a manual
  reopen [...] Once every named item is reworked and back in staged, the
  mission tail RESTARTS at Frankie (ADR 0004) [...]

checkFinalReviewRejection (FINAL APPROVED) -> null   (silent, as required)
```

### 2c — evidence staleness still keys on `staged`

The mechanism that forced this very walk:

```
report OLDER than newest staged transition ->
  STOP: Frankie's evidence bundle is STALE. [...] Dispatch Frankie to re-walk
  the FULL Definition of Done (every statement, not only previous failures —
  ADR 0004) [...]

report NEWER than every staged transition -> null    (allows)
```

### 2d — the gate is live, not inert

Both consumers destructure `stagedCount` from `countBoard` and pass it in:

```
enforce-final-review.js:98        const { ..., stagedCount } = countBoard(...)
enforce-final-review.js:125,142   checkFrankieEvidence({... stagedCount ...})
                                  checkStagedNotPromoted(stagedCount)
enforce-orchestrator-stop.js:113  const { ..., stagedCount } = countBoard(...)
enforce-orchestrator-stop.js:158,172   same two calls
```

No residual pre-`staged` phrasing anywhere in the enforcement layer or docs:

```
$ grep -rniE "back in done|reopening a done item|reopen a done item" \
    scripts/ agents/ playbooks/ commands/ docs/ adr/ CLAUDE.md
(none)
```

---

## §3 — DoD 3: `FINAL APPROVED` promotes; nothing else does

Five verdict shapes driven through `writeFinalReview` against a staged board,
re-reading the board after each call:

| Verdict shape | promotedCount | Board after |
|---|---|---|
| `VERDICT: FINAL REJECTED` | 0 | 5 staged, unchanged |
| No verdict line at all | 0 | 5 staged, unchanged |
| Ambiguous prose (both phrases present) | 0 | 5 staged, unchanged |
| `VERDICT: FINAL REJECTED`, body mentions `FINAL APPROVED` | 0 | 5 staged, unchanged |
| `VERDICT: FINAL APPROVED` | **5** | staged=0, done=7 |

Re-driven on the fresh post-restart board (2 staged):

```
VERDICT: FINAL REJECTED  -> promotedCount = 0   board: {'staged': 2}
VERDICT: FINAL APPROVED  -> promotedCount = 2   board: {'done': 2}
```

The review text was persisted by the same call that promoted:

```
$ ateam missions-final-review getFinalReview --missionId M-20260816-001
{"missionId":"M-20260816-001","finalReview":"[...] VERDICT: FINAL APPROVED"}
```

Atomicity is structural, not incidental — one `prisma.$transaction` wraps the
review write and the `staged → done` promotion, with an explicit early return
of `0` for any non-approved verdict
(`packages/kanban-viewer/src/app/api/missions/[missionId]/final-review/route.ts:90-120`),
satisfying NFR 2.

---

## §4 — DoD 4: wave-2 claimable at `staged`

```
WI-001 in briefings:
  readyItems: ["WI-001","WI-003"]   blockedItems: ["WI-002"]

WI-001 walked to staged (never through done):
  readyItems: ["WI-002","WI-003"]   blockedItems: []

$ ateam agents-start agentStart --itemId WI-002 --agent Murdock
{"success":true,"data":{"itemId":"WI-002","agent":"Murdock", ...}}
```

`deps-check` and `agentStart` agree because both consult the single shared
helper `isDependencySatisfied()` in `packages/shared/src/stages.ts`, whose
satisfying set is `['staged', 'done']`. Wave behaviour is unchanged relative
to gating on `done` alone.

---

## §5 — DoD 5: `done` is still terminal

`TRANSITION_MATRIX.done` is `[]` (`packages/shared/src/stages.ts:23`). All
eight possible outbound moves driven against the API:

```
done -> briefings     REJECTED (INVALID_TRANSITION)
done -> ready         REJECTED (INVALID_TRANSITION)
done -> testing       REJECTED (INVALID_TRANSITION)
done -> implementing  REJECTED (INVALID_TRANSITION)
done -> review        REJECTED (INVALID_TRANSITION)
done -> probing       REJECTED (INVALID_TRANSITION)
done -> staged        REJECTED (INVALID_TRANSITION)
done -> blocked       REJECTED (INVALID_TRANSITION)
```

The ADR 0005 invariant survives verbatim.

### Outbound routes from `staged` (enumerated, fresh item per probe)

```
staged -> briefings     REJECTED (INVALID_TRANSITION)
staged -> ready         ALLOWED
staged -> testing       ALLOWED
staged -> implementing  ALLOWED
staged -> review        REJECTED (INVALID_TRANSITION)
staged -> probing       REJECTED (INVALID_TRANSITION)
staged -> done          ALLOWED
staged -> blocked       ALLOWED
```

Matching source: `staged: ['done', 'testing', 'implementing', 'ready', 'blocked']`.
See Observation 1 in `walk3-report.md` — this is broader than FR 2's literal
"only routes" wording, and both extras are explainable.

Claiming a `staged` item is refused, which is why no agent can hold a claim at
tail time (the ADR 0005 rationale for Hannibal executing the move directly):

```
$ ateam board-claim claimItem --itemId WI-001 --agent Murdock
Error: INVALID_STAGE: Item cannot be claimed in stage: staged
```

---

## §6 — DoD 6: Staged renders between Probing and Done

Rendered column order, read from the accessibility snapshot of the running app:

```
BRIEFINGS · READY · TESTING · IMPLEMENTING · REVIEW · PROBING · STAGED · DONE · BLOCKED
```

With two items parked in Staged on a fresh database:

```
BRIEFINGS 0/∞    ...    PROBING 0/3    STAGED 2/∞    DONE 0/∞    BLOCKED 0/∞
  STAGED cards: WI-001 "All-staged trigger item 1"
                WI-002 "All-staged trigger item 2"
```

`BRIEFINGS` stayed at `0` throughout — no `staged` item is silently rendered
as Briefings. Staged renders `∞` (the WIP exemption of PRD requirement 9).
Cards render normally, carry the rejection badge, and the card modal opens
with full item detail including the `tail_rework` work history.

---

## §7 — Targeted re-verification requested for this walk

### WI-787 — transition matrix (`probing → done` false, `probing → staged` true)

Live behaviour matches the corrected test assertions exactly:

```
probing -> done    Error: INVALID_TRANSITION: Invalid transition from probing to done
probing -> staged  success: True   stageId: staged
```

### WI-789 — stop endpoint (Amy `probing → staged`; fallback fails closed)

```
$ ateam agents-stop agentStop --itemId WI-004 --agent Amy --outcome completed ...
nextStage = staged
```

Fail-closed path, driven against a claimed item sitting in a non-pipeline
stage (reached via `board-claim` on a `ready` item — `agentStart` cannot
produce this state because it moves `ready` items into `testing`):

```
$ curl -X POST http://localhost:5567/api/agents/stop \
    -d '{"itemId":"WI-006","agent":"Murdock","outcome":"completed",...,"advance":true}'
HTTP 400
{"success":false,"error":{"code":"INVALID_STAGE",
 "message":"No pipeline transition is defined for stage 'ready' — cannot
            determine a next stage for agentStop",
 "details":{"itemId":"WI-006","currentStage":"ready"}}}
```

Both match the corrected assertions, including the asserted message text.
These were pure test corrections with no implementation change, and the live
behaviour confirms the tests now describe reality rather than the reverse.

---

## §8 — Suites guarding the changed files

```
$ bun test scripts/hooks/__tests__/stop-gates.test.ts \
           scripts/hooks/__tests__/stop-guards.test.ts
119 pass, 0 fail, 248 expect() calls

$ npx vitest run src/__tests__/api/agents/stop.test.ts \
                 src/__tests__/api/board/move.test.ts \
                 src/__tests__/api/deps/check.test.ts \
                 src/__tests__/integration/stage-consistency.test.ts
Test Files  4 passed (4)
Tests       181 passed (181)
```
