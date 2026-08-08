# PRD: Execution Stage — Frankie, the Project QA Contract, and the Road to Auto-Merge

**Version:** 0.3.0
**Status:** Proposed (all open questions resolved 2026-08-07/08 — see §7 Decision Log)
**Author:** Josh / Claude
**Date:** 2026-08-07 (amended 2026-08-08: FlowSpec named as spec substrate)
**Issue:** theaiteam-dev/the-ai-team-plugin#51
**Repo:** `The-Ai-team` plugin (+ consumer repo configs)

---

## Executive Summary

Josh is the pipeline's first runtime: three layers read the code (Lynch,
Lynch-final, Nitpick), Amy probes per-item, but nobody drives the assembled
feature from the user's front door before Josh's QA session — so bug
*discovery* happens at the most expensive gate, and trust stays low. This
PRD adds an **in-mission execution stage**: a new agent, **Frankie**, who
walks the assembled Definition of Done against the running app after all
work items complete but before the mission's final commit. Each project
declares how to run and prove itself in `ateam.config.json` (surfaces, QA
recipe, testing level, evidence policy). Face rolls acceptance criteria up
into a **Definition of Done inside the PRD** where Josh actually reads;
Sosa bounces user-facing items whose criteria can't be driven; failures
bounce to B.A. while the mission is still in flight. The PR is **born with
evidence** — checklist, screenshots, compressed video — committed in the
mission's final commit. Frankie also writes permanent specs (critical path
+ escapes) that run in CI forever after.

**The spec substrate is [FlowSpec](https://github.com/queso/FlowSpec)**
(Josh's own tool: immutable YAML user-flow specs, accessibility-first
labels, agent-browser runner, PreToolUse hook that blocks agents from
editing `specs/`). DoD statements are drafted *as* flow files, Frankie
runs them, and passing ones graduate into hook-protected `specs/` — so
build agents structurally cannot "fix the test" instead of the bug.

**North star: unattended auto-merge.** Review tiers start risk-proportional
(hands-on → evidence-only) and each repo *earns* promotion toward
auto-merge as Frankie's accumulated FlowSpec CI suite deepens and the
scoreboard — **bugs found at Josh's gate, per week** — goes to zero and
stays there. Immutable specs are what make "green" trustworthy enough to
merge unattended.

---

## 1. Problem

Observed across print-farm, joshowens.dev, and Autocut missions:

1. **Runtime/behavioral bugs reach Josh.** Tests pass, reviews approve,
   and the feature misbehaves when actually driven. Josh finds these by
   hand in QA — he is the first person to run the assembled feature.
2. **Spec mismatch survives the whole build.** Face writes acceptance
   criteria, but they live on kanban work-item cards Josh doesn't read.
   His real touchpoints are the PRD (exec summary) and Sosa's open
   questions. A wrong-intent criteria list sails through the pipeline
   perfectly executed.
3. **Integration misses.** The recurring print-farm failure shape: wiring
   gets done per-item but never fully hooked up to the UI. Per-item tests
   pass (they exercise the item in isolation), Lynch approves (the wiring
   *is* done), Amy's item-scoped probe passes — and a user still can't
   reach the feature. Face's own rule ("a component without a route that
   renders it is an unfinished feature") has no runtime enforcement at the
   end of the pipeline.
4. **Evidence is invisible.** Amy already performs browser verification
   with screenshots (there is literally an `enforce-browser-verification`
   hook) — but the evidence lands in run artifacts nobody surfaces. Josh
   re-derives by hand what the pipeline already proved.

## 2. Solution Overview

The pipeline stays generic; **each project ships a contract** that tells
agents how to run and prove it. The corrected mission timeline:

```
Face/Sosa plan (DoD rolled into PRD, Josh blesses at existing gate)
   → per item: Murdock (tests) → B.A. (implements) → Lynch → Amy
   → ALL items done
   → FRANKIE: drives the assembled DoD against the dev server,
     in the working tree, per the project contract
        ├── any ❌ → bounce to B.A. in-mission (full context, no stale rework)
        └── green → writes .qa-evidence/ + graduated specs
   → Tawnia's final commit (feature + evidence + specs together)
   → branch pushed, PR opened — born with evidence, linked in PR body
   → Josh's step per the repo's review tier
```

Frankie runs **before any commit or branch exists** — an in-mission
stage, not a post-PR/CI stage. No artifacts plumbing, no separate upload:
evidence rides the mission's own commit.

### 2.1 Project execution contract (`ateam.config.json` extensions)

Setup already detects/asks for `checks` and `devServer`. Add:

```jsonc
{
  "surfaces": ["web"],           // web | api | fixture-flow | golden-pair | hardware | cli
  "qa": {
    "seed": "bun run seed:test", // command that produces known test data
    "account": {                  // the QA login
      "user": "qa@example.test",
      "credential_env": "ATEAM_QA_PASSWORD"
    },
    "entry_url": "/",            // the user's front door
    "drive": "flowspec",         // spec runner; surface adapter per repo
    "notes": "checkout runs in test mode; use card 4242..."
  },
  "testing_level": "critical-path",  // smoke | critical-path | full-dod
  "evidence": {
    "prd_work": "video+screenshots",  // artifact for PRD-related user-facing work
    "default": "screenshots"
  },
  "review_tier": "hands-on"           // hands-on | evidence-only | auto
}
```

- `surfaces` — how this repo is driven. `web` → browser drive.
  `fixture-flow` (conduit, flows) → fixture cards; their execution stage
  already exists. `golden-pair` (Autocut) → compare output against
  approved pairs. `hardware` (print-farm's printer side) →
  hands-on-only; no agent drives a printer.
- `qa.drive` — **tooling is a per-project decision, not a plugin-wide
  standard.** Default: `flowspec` with the surface's adapter (web via
  agent-browser today; `cli` and `conduit` adapters on the FlowSpec
  roadmap — queso/FlowSpec issues). A repo can declare a different
  driver (golden-pair diff, custom fixture runner); Frankie adapts.
- `testing_level` — how much of the DoD Frankie graduates into permanent
  CI specs each mission (see §2.5). This is the dial that deepens CI over
  time and powers tier promotion.
- `review_tier` — Josh's step when the mission's PR arrives (see §2.6).

**Face's Project Readiness Audit** (existing) gains one check: if the
mission includes user-facing work and the contract's `qa` block is missing
or stale, create a Wave-0 scaffolding item to establish it — exactly like
the existing missing-test-runner behavior.

### 2.2 Face: drivable criteria + DoD rollup

- **Format rule:** user-facing (`feature`) items get acceptance criteria
  written as user-visible sentences — "submitting a bad email shows the
  error state," not "validation handler returns 400." If it can't be
  observed from the user's side, it isn't an acceptance criterion for a
  user-facing item (it may still be a unit-test assertion for Murdock).
- **DoD rollup:** after decomposition, Face appends a **Definition of
  Done** section to the PRD itself, directly under the exec summary:
  10–15 user-visible statements covering the whole mission's user
  journey. Cards keep per-item detail for agents; the PRD carries the
  rollup for Josh. This is the two-minute intent check that kills spec
  mismatch — it lives where Josh already reads.

### 2.3 Sosa: one new rejection standard

- Reject any user-facing work item whose acceptance criteria cannot be
  driven from the project contract's entry point (not user-visible, no
  reachable path, missing QA recipe).
- The DoD rollup rides the existing refinement report through the human
  gate. Josh answers open questions and blesses/edits the DoD in the same
  sitting — no new interruption point.

### 2.4 Frankie — the manual-QA seat

*Frankie Santana: the special-effects guy. His job was staging the demo
and making it look real on camera. "Frankie's cut" is the evidence video.*

A new agent, distinct from Amy, running **once per mission after all work
items complete, before Tawnia's final commit**:

- **Input:** the PRD's DoD + the project execution contract.
- **Job:** start from the user's front door (`qa.entry_url`, logged in
  via the QA recipe) and walk every DoD statement as a first-time user,
  using the contract's declared driver. Per-item green is irrelevant; the
  question is *can a user actually reach and complete each promised
  behavior*. This is the runtime enforcement of "a component without a
  route that renders it is an unfinished feature" — the
  integration-miss killer.
- **On failure:** bounce the offending item back to B.A. **in-mission**,
  with the repro. B.A. still has full context; no post-merge rework, no
  stale fix branches.
- **On green:** write the evidence bundle and graduated specs (§2.5);
  both ride Tawnia's final commit.
- **Mindset split vs Amy:** Amy stays the investigator — break it,
  distrust it, probe beyond the checklist, per-item as today. Frankie
  verifies the *promise* — walk the list, document what a normal user
  sees, whole-mission. Different jobs, different outputs (bug reports vs
  an evidence bundle).

**Evidence bundle** (committed under `.qa-evidence/<mission>/`,
compressed — target ~5–10MB per mission):

- `report.md` — the DoD as a checklist, ✅/❌ per statement, one
  screenshot per statement via relative links (renders fully on GitHub
  for private repos — the viewer is authed).
- Screenshots (compressed) + a short compressed video for PRD-related
  user-facing work, per `evidence.prd_work`.
- The PR body links the report and shows the checklist inline.

### 2.5 Spec graduation → CI (the road to auto-merge)

**The graduated-spec format is FlowSpec** (queso/FlowSpec): immutable
YAML user flows, accessibility-first labels, run via `flowspec run` in
CI or interactively by an agent. Why it's the substrate and not
free-form Playwright:

- **Immutability = the trust guarantee.** FlowSpec's PreToolUse hook
  blocks agents from editing `specs/` — so B.A. structurally *cannot*
  "fix" a failing spec instead of the bug. Without this, every graduated
  spec is one agent-rationalization away from worthless. This is the
  property that makes the auto-merge tier defensible.
- **DoD ↔ flow file is ~1:1.** "Submitting a bad email shows the error
  state" is literally `fill/click/expect: visible`. Face's DoD
  statements get DRAFTED as flow files at planning time; Josh blessing
  the DoD = blessing executable specs; Frankie's walk = running them.
- **The label-driven grammar enforces Face's format rule mechanically** —
  only user-visible language is expressible; code-shaped criteria don't
  compile.

Mechanics:

- **Frankie writes/commits the flow files himself, in-mission**, while
  holding the steps — no handoff, no follow-up items that go stale.
  Murdock reviews them in his existing lane. They land in `specs/` under
  the protection hook, in the same PR as the feature they protect.
- **Scope per the contract's `testing_level`:** at `critical-path`
  (default), the DoD's user-journey spine graduates every mission; at
  `full-dod`, every statement does; at `smoke`, only the entry-path.
  **Plus, at every level: every escape** — any bug that reaches Josh
  after a green walk becomes a permanent flow the same week. Monotonic
  tightening; a bug class, once found, can only ever be found once.
- **`flowspec run specs/` joins the repo's CI pipeline from then on.**
  This is the compounding asset: each mission deepens the immutable
  suite, and suite depth is what makes higher velocity safe. The
  long-term picture is the true high-velocity CI/CD shape — enough
  accumulated, protected checks that green means mergeable without a
  human.
- **Surface adapters:** FlowSpec runs web today (agent-browser). `cli`,
  `conduit`, and `api` adapters are filed as FlowSpec roadmap issues
  (queso/FlowSpec#6/#7/#8) — same `steps`/`expect` grammar, per-surface
  verbs (CLI: `run`/`exit_code`/`stdout_contains`; Conduit: `seed`/
  `run_flow`/output-card assertions; API: `request`/`capture` chains
  with `status`/`json`/`latency_under` — where agents most quietly
  weaken tests). Until an adapter exists, those surfaces keep their
  native fixture checks.

### 2.6 Review tiers + the promotion ladder

`review_tier` answers one question: **what is Josh's step when the
mission's PR arrives** (evidence already baked in)?

| Tier | Josh's step |
|---|---|
| `hands-on` | Review evidence, then personally drive the feature ~5 min before merge |
| `evidence-only` | Review the bundle; merge on its strength; hands never touch it |
| `auto` | Green mission merges unattended. **Never granted — earned.** |

**Starting grid (risk-proportional):**

| Repo | Tier | Why |
|---|---|---|
| arcanelayer.com store | hands-on | Revenue surface |
| joshowens.dev | hands-on | Public face; pilot repo — eyes on Frankie's early work |
| print-farm (web) | hands-on | The integration-miss repeat offender |
| Autocut | evidence-only | Golden-pair diffs are objectively checkable |
| conduit + flows | evidence-only | Fixture runs already objectively checkable |

**Promotion ladder — the explicit long-term target is `auto`:**
a repo moves up a tier when (a) its Frankie-accumulated CI specs cover the
critical paths at its `testing_level`, and (b) its scoreboard — bugs found
at Josh's gate, per week — has been zero for an agreed stretch. Demotion
is always one config edit after a burn. Tiers make graduation a decision
with criteria instead of a drift.

## 3. Definition of Done (for this PRD — dogfooding §2.2)

1. Running `/ai-team:setup` on a repo asks about (or auto-detects)
   surfaces, QA recipe (incl. `drive`), `testing_level`, evidence policy,
   and `review_tier`, and writes them to `ateam.config.json`.
2. A mission on a repo with user-facing work and no QA recipe produces a
   Wave-0 scaffolding item to establish one.
3. After Face's decomposition, the PRD file contains a Definition of Done
   section under the exec summary, written as user-visible statements.
4. Sosa's refinement report flags any user-facing item whose criteria
   can't be driven, and includes the DoD for human blessing.
5. On a pilot mission, Frankie's walk runs after the last work item and
   before the final commit; a planted integration miss (component built,
   never routed) is caught by Frankie and bounced to B.A. in-mission —
   not found by Josh.
6. The pilot mission's PR is born with `.qa-evidence/<mission>/report.md`
   (✅/❌ checklist + screenshots, video for the PRD flow) linked from
   the PR body.
7. Frankie's graduated critical-path specs are committed in the same PR
   and run green in the repo's CI on the next PR.
8. A bug found by Josh post-evidence results in a committed spec in the
   pilot repo within the same week.

## 4. Rollout

- **Phase 1 (pilot): joshowens.dev.** First assignment: the PR #41
  QA click-through (scorecard/fix-list flow) as a standalone Frankie walk
  — closes the top merge-queue item and proves the evidence bundle.
  **The audition's checklist gets written AS joshowens.dev's first
  `specs/*.flow.yaml` files** — dogfooding FlowSpec and the execution
  stage in one move; `flowspec init` on the repo is step zero. Then the
  next real mission runs the full in-mission loop.
- **Phase 2:** print-farm (where the integration-miss pain lives), then
  arcanelayer.com store and Autocut. Conduit + flows already have
  fixture-based execution; they adopt the contract fields and tier only.
- **Phase 3:** the scoreboard (bugs at Josh's gate/week) + CI-depth
  tracking per repo; first tier promotions per §2.6.

## 5. Out of Scope

- Nitpick changes (its escape pipeline already covers the read side).
- Hardware-surface automation (printers stay hands-on).
- Replacing Amy's investigator lane — she is untouched.
- CI-hosted evidence viewers, artifact plumbing, external storage — the
  mission commit carries the evidence; revisit only if repo size actually
  hurts.

## 6. Success Metrics

- **Bugs found at Josh's gate, per week** — the trust scoreboard;
  trending to zero per repo.
- Escapes → committed specs within the same week (recall loop health).
- Frankie catch-rate: integration misses caught in-mission vs by Josh.
- Tier promotions earned (the auto-merge trajectory).

## 7. Decision Log (resolved 2026-08-07/08)

1. **Agent name: Frankie** (Santana, special effects — stages the demo).
2. **Pilot repo: joshowens.dev**, with PR #41's QA as the audition;
   print-farm is mission two.
3. **Drive tooling: per-project, in the contract (`qa.drive`)** — not a
   plugin-wide standard chosen ahead of time.
4. **Evidence: committed with the mission** (`.qa-evidence/`, compressed,
   ~5–10MB target; checklist inline in PR body; report renders
   private-safe). No CI artifacts (Frankie runs pre-commit, outside
   Actions), no external storage, no recurring cost.
5. **Spec graduation: Frankie writes specs in-mission** — critical path +
   all escapes (dial via `testing_level`); Murdock reviews; specs run in
   CI thereafter.
6. **Tiers: risk-proportional starting grid** (hands-on: store,
   joshowens.dev, print-farm web; evidence-only: Autocut, conduit/flows)
   with an explicit earned ladder to **auto-merge** — the long-term
   target — powered by accumulated Frankie CI specs + a zero scoreboard.
7. **Spec substrate: FlowSpec** (queso/FlowSpec, 2026-08-08) — DoD
   statements drafted as flow files; graduation = hook-protected
   `specs/`; immutability is the trust guarantee that makes auto-merge
   defensible. `cli` + `conduit` surface adapters filed as FlowSpec
   roadmap issues; web runs today via agent-browser.
