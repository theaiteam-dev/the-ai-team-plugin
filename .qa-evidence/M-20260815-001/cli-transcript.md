# Frankie — DoD Re-Walk CLI Transcript

**Mission:** M-20260815-001 · **PRD:** `prd/ready/staged-stage.md`
**Walked:** 2026-08-16 (re-walk after the WI-791 fix) · Companion to [`report.md`](./report.md)

All staged-stage behaviour was driven against the **local managed dev server**
(`npm run dev:qa`, `http://localhost:5567`, freshly wiped + migrated + seeded
`qa.db`). The live API (`kanban.theaiteam.dev`) has not deployed this mission's
code and was never used to judge staged-stage behaviour. Shorthand below:

```bash
A() { "$HOME/go/bin/ateam" --base-url http://localhost:5567 "$@"; }
```

---

## Fixture

```
$ A missions createMission --name "QA-REWALK-M-20260815-001" --prdPath "prd/ready/staged-stage.md" --json
{"success":true,"data":{"id":"M-20260816-001", ... }}

$ A items createItem --title "Wave-1 staged-stage fixture" ...       -> WI-001
$ A items createItem --title "Wave-2 dependent fixture" --dependencies "WI-001" ...  -> WI-002
$ A items createItem --title "Tail-rework demo item" ...             -> WI-003
```

---

## DoD 1 — all-staged triggers the walk, nothing in `done`

`probing → done` is not a legal route, so no item can reach `done` through the
per-item pipeline at all:

```
$ A board-move moveItem --itemId WI-001 --toStage done
Error: INVALID_TRANSITION: Invalid transition from probing to done

$ A board-move moveItem --itemId WI-001 --toStage staged --json
success: True     # WI-001 stage=staged
```

The Stop-hook evidence gate keys on `stagedCount`, with `doneCount` at 0:

```
$ node --input-type=module -e "... countBoard({staged:[WI-001,WI-002], done:[]}) ..."
countBoard: {"activeCounts":{},"totalActive":0,"doneCount":0,"stagedCount":2}

--- all-staged, done empty, NO evidence bundle -> must BLOCK:
STOP: Frankie's evidence bundle is missing. Expected: .qa-evidence/M-20260815-001/report.md.
Dispatch Frankie to walk the mission DoD before the Final Mission Review can proceed.
If Frankie cannot run in this environment (no Playwright headless shell, no flowspec,
dev server unavailable), re-run with ATEAM_SKIP_FRANKIE_GATE=1 to override this gate.

--- nothing staged (stagedCount 0) -> must stay SILENT:
null
```

---

## DoD 2 — tail failure moves items through pipeline mechanics alone

### 2a. Mechanics: both rework routes, rejection-cap counted

Plain `board-move moveItem` calls — no `--force`, no direct DB edit, no manual
reopen:

```
### start
   WI-001 stage=staged rejectionCount=0

### staged -> implementing (impl-only bug)
{"success":true, ...}
   WI-001 stage=implementing rejectionCount=1

### return to staged (implementing -> review -> probing -> staged)
   WI-001 stage=staged rejectionCount=1        # forward re-entry does NOT increment

### staged -> testing (test gap; earliest-flagged-stage)
{"success":true, ...}
   WI-001 stage=testing rejectionCount=2

### return to staged again
   WI-001 stage=staged rejectionCount=2
```

Repeated on a clean item (WI-003) for the end-state screenshot:

```
before bounce:  WI-003 staged      rejections 0
$ A board-move moveItem --itemId WI-003 --toStage testing --json
{"success":true, ...}
after bounce:   WI-003 testing     rejections 1
```

The API records each of these as a first-class `tail_rework` work-log entry
attributed to Hannibal (visible in the card modal, see `report.md`):

```
Hannibal  tail_rework  Aug 16, 1:20 PM   Tail rework: moved from staged to implementing
Hannibal  tail_rework  Aug 16, 1:20 PM   Tail rework: moved from staged to testing
```

### 2b. Gate instruction text — the statement that failed last walk

Same two repros as the first walk, re-run verbatim against the fixed
`scripts/hooks/lib/stop-gates.js`:

**Repro A — Frankie-failure gate**

```bash
mkdir -p $P/.qa-evidence/M-TEST && cp ateam.config.json $P/
printf '# QA report\n\n- [ ] statement two ❌ broken\n' > $P/.qa-evidence/M-TEST/report.md
node --input-type=module -e "
import { checkFrankieEvidence } from './scripts/hooks/lib/stop-gates.js';
console.log(checkFrankieEvidence({missionId:'M-TEST', stagedCount:2,
  stagedItems:[{id:'X',updatedAt:'2020-01-01T00:00:00Z'}], cwd:'$P'}));"
```

Actual output (**now correct**):

> STOP: Frankie's walk FAILED. `.qa-evidence/M-TEST/report.md` contains failing (❌)
> Definition of Done statements. Do NOT dispatch Stockwell for the Final Mission
> Review. **For each failing item, move it out of staged to testing or implementing
> using the earliest-flagged-stage rule (WI-794) — a real, rejection-cap-counted
> transition, not a manual reopen** (done is terminal, ADR 0005; items here are still
> in staged, never done). **Once the named items are reworked and back in staged**,
> dispatch Frankie to re-walk the FULL Definition of Done. If this gate is wrong for
> this environment, re-run with ATEAM_SKIP_FRANKIE_GATE=1 to override it.

**Repro B — Stockwell-rejection gate**

```bash
node --input-type=module -e "
import { checkFinalReviewRejection } from './scripts/hooks/lib/stop-gates.js';
console.log(checkFinalReviewRejection('VERDICT: FINAL REJECTED\n\nWI-003 missing pagination.'));"
```

Actual output (**now correct**):

> STOP: Stockwell's Final Mission Review verdict is FINAL REJECTED. Do NOT run
> post-checks and do NOT dispatch Tawnia. **For each item Stockwell named, move it out
> of staged to testing or implementing using the earliest-flagged-stage rule (WI-794)
> — a real, rejection-cap-counted transition, not a manual reopen** (done is terminal,
> ADR 0005; items here are still in staged, never done). **Once every named item is
> reworked and back in staged**, the mission tail RESTARTS at Frankie (ADR 0004): he
> re-walks the FULL Definition of Done before Stockwell re-reviews, so the evidence
> bundle always reflects the final code.

### 2c. Neighbour checks (ADR 0004 full re-walk)

No residual pre-`staged` phrasing anywhere in the enforcement layer or docs:

```
$ grep -rn -e "back in done" -e "reopening a done item" -e "reopen a done item" \
    scripts/ agents/ playbooks/ commands/ docs/ adr/ CLAUDE.md
  (none)
```

The gate is still wired live in both consumers (not made inert by the re-key):

```
scripts/hooks/enforce-orchestrator-stop.js:113  const { activeCounts, totalActive, doneCount, stagedCount } = countBoard(...)
scripts/hooks/enforce-orchestrator-stop.js:158  checkFrankieEvidence({ ... stagedCount, ... })
scripts/hooks/enforce-orchestrator-stop.js:172  checkStagedNotPromoted(stagedCount)
scripts/hooks/enforce-final-review.js:98        const { activeCounts, totalActive, doneCount, stagedCount } = countBoard(...)
scripts/hooks/enforce-final-review.js:125       checkFrankieEvidence({ ... stagedCount, ... })
scripts/hooks/enforce-final-review.js:142       checkStagedNotPromoted(stagedCount)
```

Evidence-staleness gate (the mechanism that forced this very re-walk) still
keys on `staged` transitions:

```
--- staged transition AFTER report mtime -> must BLOCK STALE:
STOP: Frankie's evidence bundle is STALE. .qa-evidence/M-X/report.md predates the most
recent staged transition, so items were reworked after the walk. Dispatch Frankie to
re-walk the FULL Definition of Done (every statement, not only previous failures — ADR 0004) ...

--- staged transition BEFORE report mtime -> must ALLOW:
null
```

Guard suites for the changed file:

```
$ bun test scripts/hooks/__tests__/stop-gates.test.ts scripts/hooks/__tests__/stop-guards.test.ts
 119 pass
 0 fail
 246 expect() calls
```

---

## DoD 3 — `FINAL APPROVED` promotes atomically; nothing else promotes

Five verdict shapes driven through `writeFinalReview` against a 2-item staged
board. Board re-read after each call:

```
### baseline                                                     board: {'staged': 2}
--- 1. VERDICT: FINAL REJECTED               {"promotedCount":0}  board: {'staged': 2}
--- 2. no verdict line                       {"promotedCount":0}  board: {'staged': 2}
--- 3. ambiguous (both phrases in prose)     {"promotedCount":0}  board: {'staged': 2}
--- 4. VERDICT: FINAL REJECTED + body
       mentions FINAL APPROVED               {"promotedCount":0}  board: {'staged': 2}
--- 5. VERDICT: FINAL APPROVED               {"promotedCount":2}  WI-001 done, WI-002 done
```

The review text persisted in the same call:

```
$ A missions-final-review getFinalReview --missionId M-20260816-001 --json
{"success":true,"data":{"missionId":"M-20260816-001",
 "finalReview":"VERDICT: FINAL APPROVED\n\nAll staged-stage requirements verified by Frankie's re-walk."}}
```

Atomicity is structural — one transaction wraps both:

```
packages/kanban-viewer/src/app/api/missions/[missionId]/final-review/route.ts
  88:  // The review write and the staged->done promotion share one transaction so a failure
  90:  const promotedCount = await prisma.$transaction(async (tx) => {
 100:    const stagedItems = await tx.item.findMany({ ... })
 105:    for (const { id } of stagedItems) { ... }
 120:    return stagedItems.length;
```

---

## DoD 4 — wave-2 claimable as soon as its dependency reaches `staged`

```
### BASELINE (WI-001 in briefings)
readyItems  : ['WI-001']
blockedItems: ['WI-002']

### AFTER WI-001 reached staged (never done)
readyItems  : ['WI-002']
blockedItems: []

### agentStart must agree with deps-check
$ A agents-start agentStart --itemId WI-002 --agent Murdock --json
{"success":true,"data":{"itemId":"WI-002","agent":"Murdock", ... }}
```

Source of the rule (single shared helper, so every call site stays in lockstep):

```
packages/shared/src/stages.ts
  const DEPENDENCY_SATISFYING_STAGES = ['staged', 'done'];
  export function isDependencySatisfied(stageId) { return DEPENDENCY_SATISFYING_STAGES.includes(stageId); }
```

---

## DoD 5 — `TRANSITION_MATRIX.done` is still `[]`

```
packages/shared/src/stages.ts:23     done: [],
```

Driven against the API — every one of the eight possible outbound moves from
`done` rejected:

```
  done -> briefings    : REJECTED (INVALID_TRANSITION)
  done -> ready        : REJECTED (INVALID_TRANSITION)
  done -> testing      : REJECTED (INVALID_TRANSITION)
  done -> implementing : REJECTED (INVALID_TRANSITION)
  done -> review       : REJECTED (INVALID_TRANSITION)
  done -> probing      : REJECTED (INVALID_TRANSITION)
  done -> staged       : REJECTED (INVALID_TRANSITION)
  done -> blocked      : REJECTED (INVALID_TRANSITION)
```

---

## DoD 6 — Staged renders between Probing and Done

Rendered column order read from the live DOM:

```
BRIEFINGS 0/∞ · READY 0/10 · TESTING 0/3 · IMPLEMENTING 0/3 · REVIEW 0/3 ·
PROBING 0/3 · STAGED 2/∞ · DONE 0/∞ · BLOCKED 0/∞
```

`STAGED` shows `∞` — the WIP exemption of PRD requirement 9 — and `BRIEFINGS`
stays at `0` while two items sit in Staged (nothing silently mis-columned).

Graduated spec re-validated against the running server:

```
$ flowspec run specs/staged-column.flow.yaml --base-url http://localhost:5567
✓ staged-column-on-mission-board (1.236s)
1 flow: 1 passed, 0 failed
```

---

## Promotion / rework end states (browser)

```
after FINAL APPROVED :  PROBING 0/3 · STAGED 0/∞ · DONE 2/∞
after tail bounce    :  TESTING 1/3 · STAGED 0/∞ · DONE 2/∞   (WI-003 badge: 1)
```
