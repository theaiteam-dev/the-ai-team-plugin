---
missionId: ~
---

# Mission Entry Points & Quality Profiles

**Author:** Josh Owens  **Date:** 2026-08-22  **Status:** Ready

## Executive Summary

Today the A(i)-Team has exactly one way in — a PRD through `/ai-team:plan` — and one quality setting, frozen in per-repo config. Everything else (post-mission sweeps, bug fixes, review-and-fix passes) happens outside the pipeline with generic subagents that carry none of the team's skills, produce no work items, and leave no attributable telemetry. This PRD adds three new planning entry points (`review`, `bug-fix`, `bug-stomp`) that fill a normal mission with typed work items, and a per-mission quality profile (`quick` / `normal` / `deep`) chosen at kickoff. The execution pipeline (`/ai-team:run`) is untouched: every entry point produces the same artifacts — a mission brief and a board of work items — and the existing machinery does the rest.

## Definition of Done

<!-- Face rolls per-item acceptance criteria up into this section during planning; blessed at the refinement gate. -->

- [ ]
- [ ]
- [ ]

## 1. Context & Background

The full pipeline is a fixed-price ceremony regardless of stakes: mission M-20260821-002 (a React todo client on the test-harness project) cost **$139.24**, with roughly $17 of that in the mission tail alone. There is no sanctioned cheaper path — so in practice the cheaper path is *no pipeline at all*:

- `/ai-team:sweep` reviews with the team's `code-review` skill but **fixes** with generic `clean-code-architect`/`general-purpose` subagents carrying none of the team's skills (`defensive-coding`, `test-writing`, `security-input`), no board items, no WIP limits, no rejection caps. The fixes for defects the mission's own scrutiny missed get *less* scrutiny than the original code did.
- Sweep's telemetry is unattributable: its tokens land under the main-session `hannibal` fallback with `missionId=NULL`, and its subagents land in the `general-purpose` bucket — the 5th-largest token consumer in the entire database (1.36M output tokens), a smear of every ad-hoc subagent ever spawned.
- Quality knobs already exist (`testing_level: smoke|critical-path|full-dod`, `review_tier: hands-on|evidence-only|auto` in `ateam.config.json`, per PRD 010) but are **per-repo static**: a bug stomp and a greenfield feature mission on the same repo get identical scrutiny, and changing it means editing a config file between runs.

What changed: the mission-types design discussion (2026-08-22) established that the pipeline is already item-driven — `run` doesn't care where items came from — and that item `type` already scales scrutiny (bug: 2-3 tests; feature: 3-5; NO_TEST_NEEDED tasks skip testing). The missing pieces are new front doors and a per-mission quality decision, not a new pipeline.

## 2. Problem Statement

The operator cannot quickly launch team-quality work for anything that isn't a PRD, and cannot choose how much scrutiny a mission deserves without editing repo config. As a result, common workflows (post-mission fixes, bug fixes, review passes) route around the pipeline entirely — losing skill enforcement, board visibility, rejection caps, learning capture, and cost attribution.

## 3. Target Users & Use Cases

**Primary users:**
- **The operator** (Josh, and any A(i)-Team user) — wants to point the team at work and get the right quality level with one short command.
- **The retro/tuning pipeline** — wants finding-derived work to produce learnings with real outcome data (did the fix bounce? was it a false positive?), not fire-and-forget capture rows.

**Key use cases:**
- Operator needs to run `/ai-team:review` after a mission so that review findings become board items, get fixed by skill-loaded agents, and are fully cost-attributed.
- Operator needs to run `/ai-team:bug-fix <issue#>` so that a reported bug becomes a mission with a repro test, a fix, and a review — without writing a PRD.
- Operator needs to run `/ai-team:bug-stomp` on a branch so that the team hunts, files, and fixes bugs as typed work items.
- Operator needs to say `--quality deep` (or accept an entry point's default) so that scrutiny matches stakes without touching `ateam.config.json`.
- Retro needs to derive learnings from completed finding-derived items so that capture happens once (at decomposition) and emission happens once (at debrief), with outcomes attached.

## 4. Goals & Success Metrics

| Goal | Metric | Target |
|------|--------|--------|
| One-command access to team-quality work | Operator commands to launch a quality-appropriate mission | 1 (plus optional `--quality` flag) |
| Kill the untracked-work path | Sweep-equivalent work with `missionId=NULL` token rows | 0 (all attributed to a mission) |
| Fix agents carry team skills | Skill invocations by fix agents on finding-derived items | Same skill set as any B.A. item (observable in skill-usage telemetry) |
| Quality selection without config edits | Config file edits needed to change mission scrutiny | 0 |
| Learnings carry outcomes | Finding-derived learnings with rejection/work-log outcome data | 100% of emitted rows |

## 5. Scope

### In Scope
- Three new planning entry-point commands: `/ai-team:review` (replaces `/ai-team:sweep`), `/ai-team:bug-fix <issue#>`, `/ai-team:bug-stomp`.
- The **mission brief contract**: every entry point (including existing `/ai-team:plan`) emits a PRD-equivalent document that becomes the mission's `prdPath`, so Frankie's DoD walk and Stockwell's PRD+diff review work unmodified.
- **Quality profiles** `quick` / `normal` / `deep`: named bundles over the existing execution-contract enums, resolved at planning kickoff, stored on the Mission record, overridable per invocation via `--quality` / `-q`. Agents and hooks read the mission's contract first and fall back to `ateam.config.json`.
- Entry-point default profiles: `bug-fix` → quick, `review` / `bug-stomp` → normal, `plan` → recommended by Face/Sosa from the PRD and ratified by the operator at the existing refinement gate.
- **Learning fields on work items** (severity, attributed agent by the earliest-flagged-stage rule, fingerprint/pattern) stamped at decomposition on finding-derived items; the retro agent derives `RetroLearning` rows from completed items at debrief. Sweep's direct capture step is retired.
- Retirement of `/ai-team:sweep` as a standalone review-fix-commit command (aliased or removed with a pointer to `/ai-team:review`).

### Out of Scope
- **Any change to `/ai-team:run` or the orchestration playbooks' pipeline structure.** All entry points feed the existing pipeline; scrutiny scales through item types and the quality profile, not stage masks.
- **`runAfterPlan` auto-chaining** — deferred to [issue #60](https://github.com/theaiteam-dev/the-ai-team-plugin/issues/60), along with config key-casing cleanup.
- **Tail-cost optimization for tiny missions** (e.g., skipping Frankie/Stockwell on a one-item bug-fix) — explicitly deferred; the existing no-drivable-surface exemption is the only tail skip.
- New quality knobs. Profiles bundle the *existing* enums; no new scrutiny dimensions are invented.
- Phase-2 learning lifecycle changes (resolution, tuning-round integration) — the emitted rows keep the current `RetroLearning` contract.

## 6. Requirements

### Functional Requirements

**Entry points**

1. `/ai-team:review` shall run the `ai-team:code-review` skill against the current branch, convert Must Fix and Should Fix findings into typed work items (Consider findings are reported only), emit a mission brief from the findings report, and create a mission — leaving execution to `/ai-team:run`.
2. `/ai-team:bug-fix <issue#>` shall read the referenced GitHub issue, produce a repro-oriented mission brief, and create one or more `bug`-type work items.
3. `/ai-team:bug-stomp` shall investigate the current branch for defects, and file each confirmed defect as a `bug`-type work item with a repro description, under a mission brief inventorying the hunt.
4. Every entry point (including `/ai-team:plan`) shall emit a mission brief document and set it as the mission's `prdPath`; a mission shall never be created without one.
5. Work items created by any entry point shall satisfy the existing item contract (type, description, objective, acceptance, context, outputs) so that `/ai-team:run` requires no changes.
6. A clean result (zero findings, zero bugs, issue already fixed) shall be a valid, complete outcome: the command reports it and creates no mission.

**Quality profiles**

7. Planning shall resolve exactly one quality profile per mission — `quick`, `normal`, or `deep` — from, in precedence order: the `--quality`/`-q` flag, the entry point's default, and (for `/ai-team:plan`) the Face/Sosa recommendation ratified at the refinement gate. For `/ai-team:plan` the ratified recommendation *is* the entry point's default — it applies whenever `--quality` is absent.
8. The resolved profile shall map onto the existing execution-contract enums: `quick` = `smoke` + `evidence-only`; `normal` = `critical-path` + `hands-on`; `deep` = `full-dod` + `hands-on`. Probing depth is deliberately **not** a profile dimension: Amy's standard probing pass runs unchanged at every profile — a cheaper mission is a less-tested, lighter-reviewed mission, never a less-probed one. `deep` additionally carries deepened probing guidance for Amy, defined as part of the bundle (prompt-level guidance, not a new config enum). The exact bundle definitions — both enums plus `deep`'s probing guidance text — shall live in one place, the canonical resolver (`qa-contract.js`, §9), and never be re-derived or restated per consumer.
9. The resolved contract shall be stored on the Mission record **before execution begins**: at mission creation whenever the profile is already known (the evidence-derived entry points, or any invocation with `--quality`), and at refinement-gate ratification for a flag-less `/ai-team:plan`, whose mission record exists before the recommendation does. No consumer reads the contract during planning, so the stamp always precedes first use. Every consumer of the execution contract (agents, playbooks, hooks) shall read the mission's contract first, falling back to `ateam.config.json` for missions without one.
10. `ateam.config.json`'s execution-contract fields shall remain the repo-fact source (surfaces, qa seeds, credentials, drivers) and the fallback for quality fields; no existing config is invalidated.

**Learnings**

11. Finding-derived work items (from `review` and `bug-stomp`) shall carry learning fields at creation: severity (mapped from review severity per the sweep severity table, ported into the `/ai-team:review` command definition when sweep retires — currently `commands/sweep.md` step b), attributed agent (the earliest-flagged-stage rule, `packages/shared/src/stages.ts`), and fingerprint/pattern (the match-or-create rule as written in `agents/retro.md`: compare against the top-50 from `ateam learnings fingerprints --json`, reuse on a clear match, mint a new slug otherwise). Where sweep's and retro's versions of a rule could diverge, the retro agent's are canonical — they survive sweep's retirement.
12. The retro agent shall derive `RetroLearning` rows from completed items bearing learning fields, including outcome data from `rejection_count` and `work_log`; no learning shall be written at capture time. Derivation is idempotent, keyed by the source work item ID: one derived row per finding-derived item, and a debrief that runs twice (retry, crash-resume, operator re-run) updates that item's existing row rather than inserting a second.
13. A finding disproven during the pipeline (fix agent demonstrates the flagged behavior is correct) shall surface in the derived learning with an explicit false-positive outcome value in its outcome data — never silently dropped — and shall reference the disproving evidence: the `work_log` entry (agent + summary) in which the finding was refuted.

### Non-Functional Requirements

1. Entry-point telemetry shall be mission-attributed end to end: no token usage or hook events from entry-point-initiated work may land with `missionId=NULL` once the mission exists.
2. Learning `detail` fields shall follow the existing normalization rule: no secrets, no raw diffs.
3. Mission records without a stored contract (all pre-existing missions) shall behave exactly as today via the config fallback — the change is backward compatible with the live database (additive schema only; never replace the DB file).

### Edge Cases & Error States

- `/ai-team:bug-fix` with a nonexistent, closed-as-fixed, or non-bug issue: report and stop; do not manufacture a mission.
- `/ai-team:review` on a branch with no diff against base, or with uncommitted changes: follow the existing code-review skill's scope rules; a dirty tree blocks mission creation the same way sweep's autofix precondition blocked fixes.
- An invalid `--quality` value: reject with the three valid names; never silently fall back.
- A finding that matches an already-open learning fingerprint: the item still gets created (it is work to do); the retro derivation records it as a recurrence, not a new learning.
- Entry point invoked while a mission is already active: refuse and point at the current mission — one mission at a time is unchanged.
- Quality profile on a repo with no drivable surface: profile applies to testing/review depth; the Frankie exemption is orthogonal and unchanged.

## 8. Solution Approach

The design principle: **the pipeline is already item-driven, so mission "types" are decomposition strategies, not pipeline variants.** Each entry point differs only in where items come from — a PRD (Face+Sosa), a code review (findings), a GitHub issue (repro analysis), or a bug hunt (investigation). All of them converge on the same two artifacts: a mission brief the tail agents review against, and typed work items the pipeline executes. Scrutiny scales in two emergent ways: item *types* carry their own test expectations (a board full of `bug` items is naturally a lighter mission), and the *quality profile* tunes how deeply the existing agents test, review, and evidence — chosen per mission, at kickoff, in one word.

Evidence-derived entry points need less requirements critique than prose PRDs, so each command defines its own planning depth (a light second pass rather than the full Face→Sosa→Face cycle) without affecting the others.

## 9. Technical Considerations

**Dependencies:**
- Mission record gains a stored execution contract (additive migration on the live DB, per the migration authoring guide; same shape of per-mission decision as `scalingRationale`).
- Work items gain learning fields (severity, attributed agent, fingerprint) — additive to the item schema and `ateam` CLI create/update flags.
- Retro agent contract extends to item-derived learning emission; `RetroLearning` row shape is unchanged.
- `/ai-team:bug-fix` requires `gh` CLI access to the target repo's issues.

**Integration points:**
- `qa-contract.js` (executable definition of the execution contract) becomes the single resolver for "mission contract, else config."
- Frankie/Stockwell tail, completion-gate hooks, and playbooks consume the mission brief via the existing `prdPath` — no contract change.
- Observer hooks: entry-point planning work should attribute to the mission as soon as it exists (bounded by the known pre-mission-creation attribution gap).

## 10. Risks & Open Questions

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Mission briefs from evidence (findings/issues) are thinner than PRDs, weakening the Frankie/Stockwell tail | Medium | Tail reviews against vague criteria | Brief templates per entry point with mandatory DoD statements derived from findings/acceptance |
| Profile definitions drift across consumers (agents re-interpret "quick") | Medium | Inconsistent scrutiny | Single bundle definition read by all consumers (FR-8); never restated in agent prompts |
| Tail overhead dominates tiny bug-fix missions ($15+ tail on a $5 fix) | High | Operators route around `bug-fix` again | Accepted for v1; tail optimization explicitly deferred (see Out of Scope) |
| Dual learning paths during transition (sweep capture + item derivation) double-write | Low | Duplicate learnings pollute tuning | Sweep capture retired in the same release that ships derivation |
| `general-purpose` bucket persists via other ad-hoc flows | Medium | Attribution win looks incomplete | Out of scope here; measure via the NULL-mission metric, not bucket size |

### Open Questions
- [ ] How much Sosa does each evidence-derived entry point get — a fixed light pass, or profile-dependent?
- [ ] `bug-stomp` scope: whole branch vs. diff-against-base vs. operator-supplied paths?
- [x] ~~Does `quick` shrink Amy's probing to a smoke pass?~~ **Decided (2026-09-02):** probing depth is held constant — only testing/review tiers move (FR-8).
- [ ] `bug-fix` sources beyond GitHub issues (a pasted description, a failing test) — v1 or later?
- [ ] Should `/ai-team:sweep` alias to `/ai-team:review` for one release, or be removed outright?
