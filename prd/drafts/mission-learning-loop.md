---
missionId: ~
---

# Mission Learning Loop: Structured Retro Capture & Skill Tuning Rounds

**Author:** Josh / Claude  **Date:** 2026-06-29 (revised 2026-07-01, 2026-07-02)  **Status:** Draft

## 1. Context & Background

The A(i)-Team produces learning about how to do its own work better, from two
distinct surfaces:

- **Retro (`/ai-team:retro`)** reads *telemetry only* — `listItems`, the activity
  feed, token usage, tool/skill histograms. It never reads the diff, so it can
  only learn from defects the pipeline **already caught**: rejections, Amy flags,
  Stockwell findings, cost/timing anomalies.
- **Code review (branch vs `main`)** reads the *diff*. It sees defects that
  **shipped silently** — the pipeline's blind spots, the things no gate stopped.

These are complementary. Today they are also both **dead ends**:

1. **Retro output is an unstructured blob.** `Mission.retroReport` is a single
   markdown string. Its "Action Items" table is prose — nothing aggregates across
   missions, nothing ranks by recurrence, nothing tracks whether an item ever
   shipped.
2. **Code review isn't captured at all.** It runs off to the side, the operator
   reads it, and the findings evaporate unless someone hand-writes a draft.
3. **Drafts rot.** When findings *are* written down, they land in `prd/drafts/`
   and stall. `prd/drafts/coderabbit-learnings.md` (15+ API-validation hits) and
   `prd/drafts/agent-blind-spot-fixes.md` (Murdock/B.A./Lynch/Amy prompt fixes)
   were both authored 2026-03-30 and **never shipped** — the patterns they
   propose are still absent from the skills.

The cost of this is measurable and self-inflicting. Across ~43 missions (local +
prod databases) only ~5 retros exist — a ~12% capture rate — because retro is
**manual and off-loop**. And the failure compounds: the "add `*.db` to
`.gitignore`" learning was filed *Low* in the very first local retro (2026-05-17),
never shipped, and **recurred** weeks later as the #1 Must-Fix when a 1.1 MB
`may-prod.db` was committed to a feature branch. We filed the fix and then lived
the exact failure we'd predicted.

The same patterns recur across the corpus: observer telemetry empty (3×), Lynch
review-grep gaps (5×), a skill missing a specific banned pattern (5×), handoff
ACK timeouts (2×), pool-slot races (2×), stray-artifact commits (2×). These are
not one-off bugs — they are **systematic gaps in the instruction surface** that
nothing currently forces us to close.

### Why now

We just proved (see `~/Code/OpenSource/skill-eval/SPEC.md`) that a proposed skill
or prompt change can be **empirically verified** before shipping — run the agent
N times with the baseline instruction set and N times with the proposed set,
compare pass-rates. That removes the last excuse for the graveyard: a proposed
change is no longer a guess. What's missing is the **A(i)-Team-side machinery**
that captures learnings as durable, rankable, ship-trackable records and walks
them into shipped, verified changes. This PRD specifies that machinery.

## 2. Problem Statement

Learnings from mission execution are not captured as structured data, are not
ranked by cross-mission recurrence, and are not tracked to ship. Retro is
telemetry-only and emits a prose blob; code review reads the diff but is never
persisted; both feed a `prd/drafts/` graveyard where high-value, repeatedly-hit
fixes stall indefinitely. As a result the instruction surface (skills, agent
prompts, hooks) does not improve from usage, and the same classes of defect
recur mission after mission.

## 3. Goals & Success Metrics

| Goal | Metric |
|------|--------|
| Capture becomes on-loop, not manual | Every completed mission runs a Debrief; debrief-run rate → ~100% (from ~12%). A zero-learning debrief is a valid, recorded outcome — "≥1 row per mission" would be a quota, not a metric |
| Learnings are queryable & rankable | Recurrence ranking available via a single query; top-N by `COUNT(fingerprint)` |
| Code review feeds learning | Branch-vs-`main` review findings persist as learning records, not just console output |
| Changes ship verified, not on faith | Every shipped change is eval-gated where a fixture exists; ships without one are explicitly recorded as `shipped-unverified`, never silent |
| Taste boundaries are remembered | Rejected/demoted proposals persist as durable dismissals with notes; they resurface only on new evidence (accrued hits or cross-project corroboration), never blind |
| Recurrence escalates altitude | A learning that recurs after a soft fix shipped is re-proposed at a higher enforcement altitude |

## 4. Scope

**In scope**

- A mission-end **Debrief stage** (pipeline step 10, after Tawnia commits) that
  runs the retro agent detached, ingesting the existing diff-scoped review
  surfaces (Stockwell's Final Mission Review, PR review comments) as
  additional inputs.
- **`RetroLearning`** and **`TuningProposal`** structured tables (additive
  migrations) alongside the existing `retroReport` blob.
- A **recurrence-ranking** query and `ateam` surface to read it.
- A **tuning-round** command: a human-in-the-loop walk of recurrence-ranked
  *proposed changes* with accept/edit/demote/reject/defer verbs.
- Integration of **`skill-eval`** as the verification gate before a change ships.
- **Scope-by-`projectId`** logic distinguishing local conventions from
  cross-project (global) promotions.

**Out of scope**

- Building `skill-eval` itself — it is a separate repo
  (`~/Code/OpenSource/skill-eval`); this PRD only specifies how A(i)-Team *calls*
  it.
- Model fine-tuning on this data (separate initiative,
  `~/Code/TheAITeam/MODEL-IDEA.md`).
- Auto-applying changes without human approval. Every ship is operator-approved.

### Delivery phases

The scope above ships as three separately-missioned phases; each is
independently valuable and independently shippable:

- **Phase 1 — Capture & rank.** `RetroLearning` migration, detached Debrief
  stage, match-or-create fingerprinting, recurrence-rank query + `ateam`
  surface, corpus backfill (§12). **No dependency on `skill-eval`.** **No
  dependency on the SQLite migration-system PRD** — that PRD covers the
  runtime migration *applier* (`prisma migrate deploy` + prod backfill), not
  migration authoring; `RetroLearning`'s additive `CREATE TABLE` (NFR-1) ships
  as the next migration in that same applier flow regardless of that PRD's
  status. Delivers the ranked backlog on day one.
- **Phase 2 — Tuning rounds.** `TuningProposal` migration, `ateam tuning`
  walk with the verb set (§6.3), durable dismissals with evidence-based
  resurfacing, cross-session resumability.
- **Phase 3 — Eval gate.** `skill-eval` integration against the pinned
  contract (§10), `shipped-unverified` bookkeeping, altitude escalation
  pressure on unverified ships.

## 5. Pipeline Integration (current vs. target)

**Current** mission-end sequence (`commands/run.md`):

```
… → probing → done (all items)
   → step 7: Stockwell Final Mission Review
   → post-checks (lint, unit, e2e)
   → step 8/9: Tawnia documentation + final commit  ← MISSION COMPLETE
```

Retro is a *separate, manual* `/ai-team:retro` invocation that may or may not
happen, and code review is an entirely separate operator habit.

**Target** — add step 10, the Debrief stage:

```
   → step 9: Tawnia final commit            ← MISSION COMPLETE (unchanged)
   → step 10: DEBRIEF (retro agent, detached — never blocks completion or merge)
        ├─ ingest telemetry (as today)
        ├─ ingest Stockwell's persisted Final Mission Review (getFinalReview)
        ├─ ingest PR review comments when a PR exists (CodeRabbit / human, via gh)
        ├─ emit RetroLearning rows (structured) + retroReport (human blob, as today)
        └─ mission archived
```

The Debrief runs **no reviewer of its own**. Stockwell's Final Mission Review
is already a PRD+diff-scoped review and is already persisted (`ateam
missions-final-review getFinalReview`); PR review comments already exist on
any branch with an open PR. Spawning a reviewer *inside the Debrief* would
blur its pattern-mining role at exactly the moment the operator wants to
merge.

An earlier revision of this section went further and claimed a third reviewer
at mission end would merely *duplicate* Stockwell + PR comments. Phase 1's own
mission falsified that: Stockwell approved M-20260702-001, and the operator's
habitual post-mission branch review then found three real bugs (a dedup race,
unbounded projections, stale severity in rank — RetroLearning rows 5–7).
Stockwell reviews from inside the mission, anchored on the PRD's acceptance
criteria; a cold-eyes diff-scoped review sees the blind spots §1 attributes to
code review. That review is therefore captured — but as a **separate,
operator-initiated one-shot** (`/ai-team:sweep`, shipped alongside Phase 1),
not as part of the Debrief: it runs the branch-vs-`main` review, files Must
Fix / Should Fix findings as `RetroLearning` rows with `source: code-review`
(severity mapped must→high/critical, should→medium; Consider items reported
but never captured), then auto-fixes them TDD-style in a single `fix(...)`
commit referencing the row IDs. The `@@unique(projectId, missionId,
fingerprint)` constraint keeps sweep rows and Debrief rows deduplicated to
once-per-mission per pattern. Auto-dispatching the sweep from the run command
is deliberately deferred until the one-shot has earned trust over several
missions — an unattended agent committing fixes at merge time needs a track
record first.

The tuning round is **not** part of the per-mission loop. It is a separate,
operator-initiated batch (`ateam tuning ...`) that runs across *accumulated*
learnings when the operator chooses to invest in a tuning pass.

## 6. Functional Requirements

### 6.1 Debrief stage (capture)

- **FR-1** After Tawnia's final commit, the run command dispatches the retro
  agent automatically as a **detached, non-blocking** step (no separate manual
  invocation required for the default path; `/ai-team:retro` remains available
  for re-runs). Dispatch reuses the existing native-teams background-agent
  pattern already used for peer-to-peer handoffs (fire-and-forget, no ACK
  required back to the run command) — no new dispatch mechanism is
  introduced. The mission is complete at Tawnia's commit; a Debrief that
  fails or is killed never blocks completion or merge, but the skip is logged
  (no silent gap).
- **FR-2** The retro agent ingests **both** telemetry (as today) **and** the
  existing diff-scoped review surfaces: Stockwell's persisted Final Mission
  Review and, when a PR exists, its review comments (CodeRabbit / human, via
  `gh`). Review is an *input to* retro, not a parallel process — telemetry
  finds what the pipeline caught, diff review finds what shipped silently, and
  the union is the learning set. The Debrief does **not** run a new code
  review of its own (§5).
- **FR-3** The retro agent emits, in addition to the `retroReport` blob, zero
  or more **`RetroLearning`** records (§8) — a clean mission may emit none.
  Each record's `fingerprint` is assigned by **match-or-create**: the agent is
  given the project's top 50 existing fingerprints, ranked by
  recency-weighted hit count (slug, title, hit count — cheap to fetch via
  `ateam`), and must either claim a match or justify minting a new slug. The
  cap keeps context cost flat as the corpus grows past a few hundred
  fingerprints; recency weighting keeps a currently-hot pattern from being
  crowded out by an old one-off. Fingerprints are curated slugs, not hashes of
  free text: an LLM cannot be relied on to independently reproduce a string
  across missions, but it can reliably recognize "this is the same defect as
  that one." Duplicates that slip through are collapsed with the `merge` verb
  (§6.3). `attributedAgent` is assigned using the pipeline's
  earliest-flagged-stage convention (`stages.ts`) — the earliest stage that
  could have caught the defect — consistent with how rejections are routed;
  because it is excluded from the fingerprint key (§8), a debatable call here
  never affects ranking.
- **FR-4** The blob (`retroReport`) is retained as the human-readable narrative.
  The structured rows are the machine-readable, queryable layer. Neither replaces
  the other.

### 6.2 Recurrence ranking (demand)

- **FR-5** A query ranks learnings by **cross-mission recurrence**, not
  per-mission priority. It counts **all** rows of a fingerprint (full history
  weight) but surfaces only fingerprints with live demand — at least one
  currently `open` or `recurred` row:

  ```sql
  SELECT fingerprint, pattern, targetSurface, severity, COUNT(*) AS hits
  FROM RetroLearning
  WHERE projectId = ?
  GROUP BY fingerprint
  HAVING SUM(CASE WHEN status IN ('open','recurred') THEN 1 ELSE 0 END) > 0
  ORDER BY hits DESC;
  ```

  Rationale: the telemetry-empty item was filed "High" three separate times and
  never *summed* — per-mission priority hid its true weight. Recurrence count is
  the honest demand signal. Counting all rows means a shipped-then-recurred
  fingerprint re-enters the rank at its full historical count, not at `hits=1`.
  Dismissed fingerprints are excluded from the default rank by the `HAVING`
  clause but keep accruing rows; FR-8 defines when they resurface.
- **FR-6** Surfaced via `ateam` (e.g. `ateam tuning rank --json`) for the tuning
  command to consume.

### 6.3 Tuning round (human-in-the-loop walk)

- **FR-7** `ateam tuning start` walks the recurrence-ranked learnings, presenting
  **one card per proposed change** (clustered by `targetSurface`), each with a
  **recommendation** — not raw findings. `proposalText` is synthesized at this
  point — not at capture — by a tuning agent invoked when the operator
  selects `accept` or `edit`; learnings that are `defer`red, `reject`ed, or
  never walked never pay this drafting cost. The operator chooses a verb:
  | Verb | Effect |
  |------|--------|
  | **accept** | Proposal advances to the eval gate (§6.4) as written |
  | **edit** | Operator amends the proposal, then it advances to the eval gate |
  | **merge** | Collapse a duplicate fingerprint into an existing one; hit counts sum |
  | **demote** | Real but lower altitude than proposed; re-scoped down, durable `dismissed` note on the original altitude |
  | **reject** | Not a defect (taste); writes a durable dismissal with note (FR-8) |
  | **defer** | Leave `open`; resurfaces next round |
- **FR-8** `reject` and `demote` produce **durable dismissals** (a `dismissed`
  `TuningProposal` carrying a `dismissalNote`) so the same taste boundary is
  **not re-litigated blind**. Dismissal is durable but not deaf: capture never
  filters on status, so a dismissed fingerprint keeps accruing hits. It
  resurfaces in the rank when it gains **≥3 new hits since dismissal** or on
  its **first cross-project hit** (breadth trumps a single-project taste
  call); the resurfaced card carries the original dismissal note, so the
  operator re-decides with memory — "you rejected this at 3 hits; it is now
  at 9."
- **FR-9** **Two-bar model.** Fixing an *instance* and *capturing* it is always
  allowed (low bar). Promoting a learning to a **system rule** (a skill/prompt/hook
  change) requires the higher bar: objectivity (a ground-truth failure mode) +
  an **adversarial steelman** (an independent agent argues why a competent dev did
  this on purpose) + corroboration — the same threshold as dismissal
  resurfacing (FR-8): ≥3 hits within a project, or 1 cross-project hit, per
  the scoping model in §6.6.

### 6.4 Eval gate (verification before ship)

- **FR-10** A proposal that the operator accepts is verified before ship. The
  gate scales with altitude **and with fixture availability** — mandatory
  where it can actually fire, explicit-when-bypassed where it cannot:
  | Altitude | Gate |
  |----------|------|
  | Enforcement hook | Deterministic unit test (1 run) — **always mandatory** (always feasible) |
  | Skill / agent-prompt text, fixture exists | N-run `skill-eval` A/B comparing pass-rates (per-card isolation) — **mandatory** |
  | Skill / agent-prompt text, no fixture | Operator may ship with explicit **`shipped-unverified`** status; a later recurrence is flagged as post-unverified-ship |
  | Accepted batch (round) | Per-round mini-mission A/B via `--plugin-dir` (end-to-end check where fixtures allow) |

  A gate that is nominally mandatory but mostly cannot fire would simply be
  routed around; `shipped-unverified` keeps the bypass honest and lets
  recurrence — not speculation — decide which fixtures are worth building.
- **FR-11** Where an A/B runs, it must show (a) the **baseline** arm reproduces
  the gap (finding is real) and (b) the **proposed** arm closes it **without
  regressing** the skill's other scenarios. A proposal that fails either check
  does not ship; its status becomes `eval-failed` and the eval output is
  persisted on `TuningProposal.evalResult`, so it returns to the next round
  with the result attached.
- **FR-12** Ship is a **proposal** event, not a learning event: the proposal's
  `status` → `shipped` (or `shipped-unverified`) and `shippedInCommit` records
  the commit SHA; its linked learnings flip to `resolved`.

### 6.5 Altitude escalation on recurrence

- **FR-13** If a fingerprint whose proposal shipped **recurs** (a new mission
  emits a matching `fingerprint`), its `resolved` learnings re-open as
  `recurred` and the next proposal is drafted at the **next altitude up** the
  ladder (skill text → agent prompt/checklist → enforcement hook). The soft
  fix that already failed is not re-shipped as-is. Per FR-5 the fingerprint
  re-enters the rank carrying its full historical hit count. A recurrence
  after a `shipped-unverified` ship is additionally the signal to build the
  missing fixture (FR-10).

### 6.6 Scope by blast radius (`projectId`)

- **FR-14** A learning corroborated within a **single project** is treated as a
  **local convention/preference** — its change is scoped to that project's
  context where possible.
- **FR-15** A learning corroborated **across projects** (same `fingerprint`,
  different `projectId`) is eligible for promotion to a **global plugin skill**.
  Cross-project breadth is a stronger promotion signal than single-project
  recurrence-over-time, and faster to accrue than waiting for one project to
  re-hit it repeatedly.

## 7. Non-Functional Requirements

- **NFR-1** The migration adding `RetroLearning` MUST be **additive only** — a
  single `CREATE TABLE` + indexes, no destructive change to the live DB.
  Back-relations on `Project`/`Mission` are Prisma-side only. (See the
  never-replace-the-live-DB rule and `docs/PLUGIN-DEV.md` migration guidance.)
- **NFR-2** The Debrief is detached (FR-1) and adds **zero blocking latency**
  to mission completion or merge. Its own cost is bounded by ingesting
  already-persisted review surfaces rather than running a new review (FR-2).
- **NFR-3** The tuning round must be resumable — the operator may walk a long
  backlog across sessions; verb decisions persist immediately.
- **NFR-4** No learning record stores secrets or raw diffs verbatim; `detail`
  holds a normalized description, consistent with how skill activations store an
  `args_hash` rather than args.

## 8. Data Model

Two new child tables, following the `MessageTokenUsage` convention
(autoincrement id, `projectId` FK, `onDelete: SetNull` for mission, indexed).
`RetroLearning` ships in Phase 1; `TuningProposal` in Phase 2 (both additive):

```prisma
model RetroLearning {
  id              Int      @id @default(autoincrement())
  projectId       String
  project         Project  @relation(fields: [projectId], references: [id])
  missionId       String?
  mission         Mission? @relation(fields: [missionId], references: [id], onDelete: SetNull)
  source          String   // stockwell | pr-review | rejection | amy | telemetry | cost | retro | code-review
  severity        String   // low | medium | high | critical (API-enforced enum; review vocab
                           // must/should/consider maps to this at the capture boundary — sweep/retro)
  attributedAgent String   // murdock | ba | lynch | amy | stockwell | tawnia | hannibal | process
  targetSurface   String   // skill:defensive-coding | agent:lynch | hook | gitignore | docs
  pattern         String   // curated slug via match-or-create — "api-input-validation-depth"
  fingerprint     String   // pattern + targetSurface — recurrence key (NOT a hash; see below)
  title           String
  detail          String?
  status          String   @default("open")  // open | recurred | resolved | dismissed
  proposalId      Int?
  proposal        TuningProposal? @relation(fields: [proposalId], references: [id])
  createdAt       DateTime @default(now())

  @@index([projectId, status])
  @@index([fingerprint])
  @@index([missionId])
}

model TuningProposal {
  id              Int      @id @default(autoincrement())
  projectId       String
  project         Project  @relation(fields: [projectId], references: [id])
  targetSurface   String
  altitude        String   // skill-text | agent-prompt | hook
  proposalText    String
  status          String   @default("draft") // draft | accepted | eval-running | eval-failed | shipped | shipped-unverified | dismissed
  evalResult      String?  // persisted skill-eval output — attached on pass or fail
  dismissalNote   String?  // why the operator rejected/demoted; shown on resurface
  shippedInCommit String?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  learnings       RetroLearning[]

  @@index([projectId, status])
}
```

- `Mission.retroReport` (existing `String?`) is **retained** as the human blob.
- **A learning is an observation; a proposal is a change.** Many learnings
  cluster into one proposal (by `targetSurface`); a learning doesn't ship, a
  proposal does — proposal text, altitude, eval results, and `shippedInCommit`
  all live on `TuningProposal`. The tuning round's state *is* the proposal
  rows: verb decisions persist immediately, making resumability (NFR-3)
  structural rather than aspirational.
- `fingerprint` is the recurrence join key: *pattern + targetSurface*, assigned
  by match-or-create (FR-3), never a hash of free text. It **deliberately
  excludes `attributedAgent`**: attribution is often ambiguous (the pipeline's
  own earliest-flagged-stage principle encodes this — a shipped bug is at once
  Murdock's missing test, B.A.'s defect, and Lynch's review miss), and putting
  the agent in the key would split one pattern's recurrence count across
  attributions. `attributedAgent` stays on the row for analysis.

## 9. Edge Cases & Error States

- **Duplicate within one mission** — same `fingerprint` emitted twice by retro in
  one debrief: dedupe at write time; count once per mission for recurrence.
- **Review inputs unavailable** — no persisted Stockwell final review and/or
  no PR: retro degrades to whatever review surfaces exist, or telemetry-only
  (today's behavior), and logs which inputs were skipped (no silent gap).
- **Eval can't reach a finding** — backend/Go-CLI findings have no fixture in the
  one frontend mini-mission (see `skill-eval/SPEC.md` §7). Such a proposal gets
  per-card *diagnosis* eval where possible; the operator may still ship it with
  explicit `shipped-unverified` status (FR-10) — recorded, never silent, and
  flagged if the fingerprint recurs.
- **Recurrence after top-of-ladder hook ship** — a defect that recurs even after
  a hard hook: escalate to operator as a design problem, not another altitude bump.
- **Demote/reject reversal** — a dismissal resurfaces automatically on new
  evidence (≥3 new hits or a cross-project hit, FR-8) and can also be re-opened
  explicitly by the operator; dismissal is durable, not permanent — and never
  deaf, since capture ignores status.

## 10. Dependencies

- **`~/Code/OpenSource/skill-eval`** — the eval gate (FR-10/11), **Phase 3
  only**; Phases 1–2 have no dependency on it. The integration requires a
  pinned `compare` contract, agreed before Phase 3 starts: inputs (baseline
  instruction set, proposed instruction set, scenario fixture, N), outputs
  (per-arm pass rates + verdict, machine-readable), and exit-code semantics
  (non-zero on regression). "Exists or is built in parallel" is not
  sufficient for Phase 3 promotion.
- **Stockwell Final Mission Review persistence** — `ateam
  missions-final-review getFinalReview` (already shipped) is the primary diff
  review input to the Debrief stage.
- **`gh` CLI** — fetches PR review comments (CodeRabbit / human) as the second
  review input when a PR exists.
- **SQLite migration system** (`prd/ready/sqlite-migration-system.md`,
  `docs/PLUGIN-DEV.md`) — **not a blocking dependency**. That PRD covers the
  runtime migration applier (`prisma migrate deploy`) and a one-time prod
  backfill, not how individual migration files are authored; `RetroLearning`'s
  additive `CREATE TABLE` (NFR-1) ships on Phase 1's own timeline as the next
  migration in the existing flow.
- **Observer telemetry** — already feeds retro; unchanged.

## 11. Risks & Decisions

- **Decision: rank by recurrence, not priority.** Per-mission severity is kept on
  the row but ranking is `COUNT(fingerprint)`. Priority labels proved unreliable
  (the telemetry item filed "High" 3× without ever summing).
- **Decision: review is an input to retro, not a sibling stage — and no new
  reviewer runs.** Stockwell's persisted final review and existing PR review
  comments are ingested; spawning a third reviewer at mission end would
  duplicate both and add cost at exactly the merge moment. One capture path,
  one learning set, one table.
- **Decision: capture is on-loop; tuning is batched and manual.** The ~12% capture
  rate is caused by retro being manual; making *capture* automatic fixes it, while
  keeping the *expensive* tuning+eval work operator-initiated controls cost.
- **Decision: the capture metric is debrief-run rate, not rows emitted.** A
  "≥1 learning per mission" target is a quota — the retro agent would
  manufacture findings on clean missions and pollute the very table the rank
  reads. Zero-learning debriefs are valid.
- **Risk: match-or-create biases toward over-merging.** The agent may lazily
  claim a match rather than justify a new slug, undercounting genuinely new
  patterns. This is the right side to err on — a false merge inflates a rank
  the operator was going to inspect anyway, while a false split hides demand
  entirely — but it is a real bias: the tuning round can split a wrongly
  merged fingerprint, and the `merge` verb handles the opposite failure.
- **Risk: over-fitting a skill to its eval.** Mitigated by FR-11's regression
  requirement (proposed must not regress other scenarios) and small-N evals that
  only detect decisive effects.
- **Risk: fixture coverage.** The highest-severity recurring findings come from
  backend/plugin missions with no mini-mission fixture. FR-10's
  `shipped-unverified` path keeps the gate honest in the meantime, and
  recurrence-after-unverified-ship — not speculation — decides which fixtures
  get built. Resolution is per-surface fixtures over time, not a blocker.
- **Risk: dismissed-row drift.** Taste boundaries change; mitigated by
  evidence-based resurfacing (FR-8) plus explicit re-open (no permanent
  suppression).

## 12. Validation Plan

- Replay the existing corpus: backfill `RetroLearning` from the 5 historical
  retros + the two stalled drafts, confirm the recurrence query surfaces the known
  repeat offenders (telemetry-empty, Lynch grep-gaps, missing banned-pattern,
  `.gitignore *.db`) in rank order — i.e. match-or-create converges each repeat
  offender onto a single fingerprint rather than near-duplicate slugs.
- Run one real Debrief on a fresh mission; confirm it is detached (the mission
  completes and is mergeable even if the Debrief is killed), that it emits
  structured rows *and* the blob, and that review findings appear as
  `source=stockwell` / `source=pr-review` rows.
- Walk one tuning round end-to-end on a single accepted skill change: confirm the
  `skill-eval` gate runs, the baseline-shows-gap / proposed-closes-without-regress
  assertions are enforced, and ship stamps `shippedInCommit` on the proposal and
  flips its linked learnings to `resolved`.
- Confirm a `reject` writes a durable dismissal that does **not** resurface next
  round, then simulate 3 new hits (or one cross-project hit) and confirm it
  **does** resurface carrying its dismissal note.

## 13. Success Criteria

- Every completed mission runs a Debrief; debrief-run rate ≈ 100% (a
  zero-learning debrief counts — rows are evidence, not quota).
- `ateam tuning rank` returns recurrence-ranked learnings for a project.
- At least one skill/prompt change ships through the full loop (capture → rank →
  walk → `skill-eval` gate → ship) with proposal `status=shipped` +
  `shippedInCommit`.
- A previously-stalled draft pattern (e.g. API-input-validation depth) is shipped
  and verified, and does **not** recur in the next mission touching that surface.
- No structured learning is lost to a `prd/drafts/` graveyard — the table is the
  backlog of record.
```
