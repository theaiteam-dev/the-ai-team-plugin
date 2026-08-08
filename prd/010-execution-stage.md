# PRD: Execution Stage — Project QA Contract + DoD-Driven Manual QA

**Version:** 0.1.0
**Status:** Proposed
**Author:** Josh / Claude
**Date:** 2026-08-07
**Issue:** theaiteam-dev/the-ai-team-plugin#51
**Repo:** `The-Ai-team` plugin (+ consumer repo configs)

---

## Executive Summary

Josh is the pipeline's first runtime: three layers read the code (Lynch,
Lynch-final, Nitpick), Amy probes per-item, but nobody drives the assembled
feature from the user's front door before Josh's QA session — so bug
*discovery* happens at the most expensive gate, and trust stays low. This
PRD adds an **execution stage**: each project declares how to run and prove
itself in `ateam.config.json` (surfaces, QA login/seed recipe, evidence
policy); Face rolls acceptance criteria up into a **Definition of Done**
inside the PRD where Josh actually reads; Sosa bounces user-facing items
whose criteria can't be driven in a browser; and a new manual-QA agent
drives the DoD end-to-end after implementation, attaching a
screenshot/video evidence bundle to the PR. Josh's gate becomes reviewing
evidence (plus five hands-on minutes where the contract says so) instead of
discovering bugs. Every bug that still reaches him becomes a permanent
committed spec. Success metric: **bugs found at Josh's gate, per week,
trending down.**

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

Five pieces. The pipeline stays generic; **each project ships a contract**
that tells agents how to run and prove it.

### 2.1 Project execution contract (`ateam.config.json` extensions)

Setup already detects/asks for `checks` and `devServer` ("where Amy should
point Playwright"). Add three fields:

```jsonc
{
  "surfaces": ["web"],            // web | fixture-flow | golden-pair | hardware | cli
  "qa": {
    "seed": "bun run seed:test",  // command that produces known test data
    "account": {                   // the QA login
      "user": "qa@example.test",
      "credential_env": "ATEAM_QA_PASSWORD"
    },
    "entry_url": "/",             // the user's front door
    "notes": "checkout runs in test mode; use card 4242..."
  },
  "evidence": {
    "prd_work": "video+screenshots",   // required artifact for PRD-related user-facing work
    "default": "screenshots",
    "review_tier": "hands-on"          // hands-on | evidence-only | auto
  }
}
```

- `surfaces` — how this repo is driven. `web` → browser drive.
  `fixture-flow` (conduit, flows) → run against fixture cards; their
  execution stage already exists. `golden-pair` (Autocut) → compare output
  against approved raw/posted pairs. `hardware` (print-farm's printer
  side) → marked hands-on-only; no agent drives a printer.
- `qa` — the difference between "an agent has a URL" and "an agent can
  reach the interesting screens." Missing seed/auth is where execution
  stages die; declaring it makes it auditable.
- `evidence.review_tier` — Josh's per-repo policy: user-facing repos keep
  his five hands-on minutes; internal repos merge on audited evidence.

**Face's Project Readiness Audit** (existing) gains one check: if the
mission includes user-facing work and the contract's `qa` block is missing
or stale, create a Wave-0 scaffolding item to establish it — exactly like
the existing missing-test-runner behavior.

### 2.2 Face: drivable criteria + DoD rollup

- **Format rule:** user-facing (`feature`) items get acceptance criteria
  written as user-visible sentences — "submitting a bad email shows the
  error state," not "validation handler returns 400." If it can't be
  observed in a browser, it isn't an acceptance criterion for a
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

### 2.4 New agent seat: manual QA (name TBD — see Open Questions)

A new agent, distinct from Amy, added to the mission flow after
implementation completes (post-Lynch, alongside/after Amy's probing):

- **Input:** the PRD's DoD + the project execution contract.
- **Job:** start from the user's front door (`qa.entry_url`, logged in via
  the QA recipe) and walk every DoD statement as a first-time user.
  Per-item green is irrelevant; the question is *can a user actually reach
  and complete each promised behavior.* This is the runtime enforcement of
  "a component without a route that renders it is an unfinished feature" —
  the integration-miss killer.
- **Output:** the evidence bundle attached to the PR — the DoD as a
  checklist with ✅/❌ per statement, a screenshot per statement, and
  video for PRD-related user-facing work (per `evidence.prd_work`).
  Failures bounce back to B.A. with the repro before Josh ever sees the
  PR.
- **Mindset split vs Amy:** Amy stays the investigator — break it,
  distrust it, probe beyond the checklist. The manual-QA seat verifies the
  *promise* — walk the list, document what a normal user sees. Different
  jobs, different outputs (bug reports vs an evidence bundle).

Tooling: agent-browser (existing, Amy-trained) for the walk;
Playwright's recorder for video where the contract demands it.

### 2.5 Recall loop + scoreboard

- Any bug Josh finds *after* a green evidence bundle is an **escape of the
  execution stage**. Every escape becomes a permanently committed spec
  (Playwright test or fixture) so that class of bug can only ever be found
  once. Same monotonic-tightening religion as Nitpick's post-merge escape
  pipeline, one station later.
- **Scoreboard metric: bugs found at Josh's gate, per week.** That number
  falling is what "trust the pipeline" measurably means.

## 3. Definition of Done (for this PRD — dogfooding §2.2)

1. Running `/ai-team:setup` on a repo asks about (or auto-detects)
   surfaces, QA recipe, and evidence policy, and writes them to
   `ateam.config.json`.
2. A mission on a repo with user-facing work and no QA recipe produces a
   Wave-0 scaffolding item to establish one.
3. After Face's decomposition, the PRD file contains a Definition of Done
   section under the exec summary, written as user-visible statements.
4. Sosa's refinement report flags any user-facing item whose criteria
   can't be driven, and includes the DoD for human blessing.
5. On a pilot mission, the PR arrives with an evidence bundle: DoD
   checklist with per-statement ✅/❌, screenshots, and video for the
   PRD-related flow.
6. A deliberately planted integration miss (component built, never routed)
   is caught by the manual-QA drive, not by Josh.
7. A bug found by Josh post-evidence results in a committed spec in the
   pilot repo within the same week.

## 4. Rollout

- **Phase 1 (pilot):** one repo — joshowens.dev or print-farm (see Open
  Questions) — gets the extended contract + the new agent on its next
  real mission. Prove the evidence bundle end-to-end on one feature.
- **Phase 2:** roll the contract to the hot repos: arcanelayer.com store,
  joshowens.dev, print-farm, Autocut. Conduit + flows are already covered
  by their fixture-flow surface and are out of scope for the browser
  drive.
- **Phase 3:** the scoreboard — track bugs-found-at-Josh's-gate weekly;
  escapes → committed specs.

## 5. Out of Scope

- Nitpick changes (its escape pipeline already covers the read side).
- Hardware-surface automation (printers stay hands-on).
- Replacing Amy's investigator lane — she is untouched.
- CI-hosted evidence viewers / report hosting (artifacts + PR comment are
  enough for the pilot).

## 6. Open Questions

1. **Name for the manual-QA agent.** Frankie (Santana — the special
   effects guy, makes the demo) is the obvious lore candidate. Josh's
   call.
2. **Pilot repo:** joshowens.dev (PR #41's QA click-through is the
   perfect first evidence-bundle assignment) or print-farm (where the
   integration-miss pain actually lives)?
3. **Video tooling:** Playwright recorder for the DoD walk, or extend
   agent-browser with a recording mode? (Screenshots are already solved
   via agent-browser.)
4. **Where evidence lives:** inline PR comment with screenshots + linked
   artifacts, or committed to a `.qa-evidence/` branch dir? GitHub video
   embedding prefers mp4/mov — conversion step needed for webm.
5. **Who owns spec graduation:** when a DoD statement passes, does the
   manual-QA agent write the permanent Playwright spec, or hand it to
   Murdock as a follow-up item?
6. **Existing repos' review tiers:** proposed defaults — store: hands-on;
   joshowens.dev: hands-on; print-farm web: hands-on; Autocut: golden-pair
   evidence-only; conduit/flows: fixture evidence-only. Confirm/adjust.
