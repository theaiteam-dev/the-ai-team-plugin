---
missionId: ~
---

# Async Intake & Triage

**Author:** Josh / Claude  **Date:** 2026-08-08  **Status:** Draft

## 1. Context & Background

Today the A(i)-Team has exactly one door for work to enter the system, and it is a heavy one. The only supported path is: author a PRD document (`write-prd` runs a synchronous discovery workshop with the operator present), then run `/ai-team:plan`, which executes the full Face → Sosa → Face decomposition ceremony and calls `createMission --force` — which archives whatever mission was already active.

Three consequences fall out of that single-door design:

1. **Every input pays full fare.** A one-line bug and a multi-week feature go through the same pipe. `write-prd` has a Quick tier, but even Quick produces a document that then needs mission creation and a decomposition pass. There is no path where a small thing simply *becomes* a work item.
2. **Capture requires the operator, synchronously, in a Claude session.** The real job of GitHub Issues (or JIRA) is not tracking — it is *cheap asynchronous capture*. A half-formed thought, a Sentry alert, or a user complaint can land in a queue at 2am with nobody scoping it. The A(i)-Team has no equivalent; the closest thing is `prd/ready/`, a queue of *finished documents*, which is the opposite of cheap capture.
3. **The singleton active mission makes small work structurally homeless.** While a big mission runs, a bug fix cannot enter at all without archiving the mission. So small items pile up in the operator's head — which is exactly the queue that Issues/JIRA would have held.

There is also a self-generated stream the system currently throws away. Amy's out-of-scope findings, Stockwell's final-review observations, and retro recommendations mostly die inside report columns (`Mission.finalReview`, `Mission.retroReport`). In a GitHub-centric shop those would become issues automatically. That is intake too, and it is the easiest kind to capture because it is already structured.

A prior exploration of the API internals found that the data model already contains most of an intake layer, unintentionally:

- **Mission membership is an overlay, not ownership.** `Item` belongs to `Project`; missions attach items through a `MissionItem` join table. The kanban board query (`GET /api/board`) filters by `projectId + archivedAt: null` only — it does not join through mission. An item with no mission attachment renders on the board today.
- **Archiving spares unattached items.** `createMission --force` archives only the items reachable through the *old mission's* `MissionItem` rows. An unattached item survives mission turnover indefinitely — exactly the persistence property a backlog needs.
- **Attachment is automatic and time-based.** `POST /api/items` links a new item to the current active mission if one exists, or creates it unattached if not. "Inbox items" are already an expressible state — they just can only be born between missions, and an item captured *during* a mission is silently absorbed into it.
- The first stage's DB id is literally `'backlog'` (displayed as "briefings"). The name was there all along.

The gap is smaller than it first appears. What is missing is (a) a pre-scoped state that distinguishes raw intent from dispatchable work, (b) a capture surface, and (c) the triage act that promotes raw intent into scoped work.

## 2. Problem Statement

Work can only enter the A(i)-Team by authoring a full PRD and archiving the active mission, which fuses cheap capture to expensive scoping and forces every input — regardless of size or risk — through the same heavy, synchronous, operator-present door. There is no asynchronous way to capture intent, no lightweight path for small work, no persistent backlog for blessed-but-not-yet-scheduled items, and no home for the structured findings the pipeline generates about itself.

## 3. Target Users & Use Cases

**Primary users:**

- **Operator (Josh)** — needs to capture intent from anywhere (including a phone, async, at any hour) without sitting through a workshop, and needs to *ratify* the system's understanding rather than author it exhaustively up front.
- **Triage agent (new role)** — reads raw intent, classifies it by risk/ambiguity, and drafts either a PRD (heavy) or a set of work items (light) for the operator to review.
- **Pipeline agents (Amy, Stockwell, retro)** — need somewhere to file the out-of-scope and cross-cutting findings they currently surface only in report text.
- **Hannibal (orchestrator)** — needs a backlog it can draw blessed work from, including between and around large missions.

**Key use cases:**

- Operator opens a GitHub issue describing a feature, applies the `ateam:prd` label, and within minutes a branch appears with a drafted PRD linked to the issue for review.
- Operator reviews the drafted PRD via the PR diff UI, requests changes with normal review comments, and the draft is revised; merging into `prd/ready/` is the "ready for work" event.
- Operator opens a GitHub issue for a small bug, the triage agent posts drafted work items (objective, acceptance, context, proposed type) as an issue comment, and the operator applies `ateam:ready` to promote them into the backlog.
- The triage agent mis-classifies weight; the operator swaps the label (`ateam:ready` ↔ `ateam:prd`) to move the item to the other track without re-capturing it.
- Amy finds a bug outside the current item's scope; instead of burying it in a report, the system files a GitHub issue that re-enters this same funnel.
- A blessed backlog accumulates small items; a patrol run gathers them into a batched mission when the board is quiet.

## 4. Goals & Success Metrics

| Goal | Metric | Target |
|------|--------|--------|
| Make capture cheap and async | Median operator time to capture one input | Under 30s, no Claude session required |
| Give small work a lightweight path | Small items reaching the board without a PRD document | Supported (currently 0) |
| Invert authoring to ratification | Heavy-path PRDs drafted by agent, not hand-authored | Every heavy-path item |
| Persist blessed-but-unscheduled work | Backlog items surviving mission turnover | 100% |
| Home the self-generated stream | Out-of-scope agent findings that become trackable intake | Supported (currently discarded) |
| Single source of truth for "ready" | Distinct systems holding the canonical ready signal | Exactly 1 per path |

## 5. Scope

### In Scope

- **Two intake tracks, both GitHub-native and both gated by a single explicit event:**
  - **Heavy (PRD) path** — issue + `ateam:prd` label → headless agent drafts a PRD onto a branch → PR linked to the issue → operator review → merge into `prd/ready/` is the promotion gate.
  - **Light path** — issue → triage agent posts drafted work items as an issue comment → operator applies `ateam:ready` label → items created in the backlog. The label *is* the promotion event.
- **A label-driven state machine** on GitHub issues (`ateam:intake` → `ateam:scoped` → `ateam:ready`, plus `ateam:prd` as the track selector / escape hatch).
- **A triage agent role** that classifies raw intent by blast radius (ambiguity + risk), not size alone, and drafts the appropriate artifact.
- **"Nothing enters the DB until blessed"** — drafted work items live only as an issue comment (a proposal) until the promotion gate fires; the gate is what creates unattached backlog items.
- **A backlog/inbox stage** distinguishing raw/unscoped intent from scoped, dispatchable work items (one column or one flag — see Open Questions), such that unscoped items never leak into `deps-check` ready lists.
- **A capture verb** — a thin CLI surface (`ateam inbox add "..."`) writing an unattached, unscoped item, for operator-in-a-session capture that does not disturb a running mission.
- **The self-generated stream** — a mechanism for Amy/Stockwell/retro findings to file into the same funnel (auto-created GitHub issues or direct inbox items).
- **A drain mechanism** — how blessed backlog items get pulled into a mission (a patrol run and/or next-planned-mission sweep).
- **Kanban Inbox view** — surfacing captured-but-unscheduled items distinct from active-mission columns.

### Out of Scope

- **GitHub as the tracker of record.** GitHub is the *capture and ratification surface*; the ateam DB remains the execution record. We are not migrating mission state to GitHub.
- **Third-party webhook sources (Sentry, Slack, email).** The architecture should make these just another writer to the same table, but wiring specific providers is a later PRD.
- **Federated / cross-project intake.** Single-project scoping as today.
- **Replacing `write-prd`.** The workshop remains available for operator-driven authoring; this PRD adds the *agent-drafted, ratify-not-author* path alongside it.
- **Automatic merge or auto-promotion.** Both gates are explicit human events by design (see Design Principles).
- **Multiple concurrent large missions.** The backlog persists outside missions, which relieves most of the singleton pressure; true concurrent missions remain a separate question.

## 6. Requirements

### Functional Requirements

**Capture**

1. The system shall accept work intent from a GitHub issue with no required structure beyond a title and body.
2. The system shall provide a CLI verb that captures a single line of intent as an unattached, unscoped backlog item without archiving or disturbing any active mission.
3. The system shall not absorb newly captured intent into a running mission implicitly; captured intent is unattached until explicitly promoted.

**Triage & drafting**

4. The system shall classify each captured input by blast radius (ambiguity and risk), producing a track recommendation of *heavy* (PRD) or *light* (direct work items).
5. On the heavy path, the system shall draft a full PRD (scaled to tier) onto a dedicated branch and open a PR linked to the originating issue.
6. On the light path, the system shall draft one or more work items — each with objective, acceptance criteria, context, and proposed type — and post them as a comment on the originating issue.
7. The triage agent shall run headlessly (no operator present) and complete drafting within a bounded time of the triggering event.

**Gating & promotion**

8. The heavy-path promotion gate shall be the merge of the drafted PRD into `prd/ready/`; that merge shall be the single canonical "ready for work" signal for that item.
9. The light-path promotion gate shall be the application of the `ateam:ready` label; that label event shall create the corresponding work items in the backlog as unattached, scoped items.
10. No work item shall be written to the database before its promotion gate fires. Prior to promotion, drafted items exist only as an issue comment.
11. The operator shall be able to reclassify an input between tracks by changing its label, without re-capturing the intent.

**Backlog & drain**

12. The board shall distinguish unscoped intake from scoped, dispatchable items such that unscoped items never appear in `deps-check` ready lists.
13. Blessed backlog items shall survive mission creation, completion, and archival (i.e., remain unattached until drawn into a mission).
14. The system shall provide a mechanism to draw blessed backlog items into a mission (patrol run and/or planned-mission sweep).

**Self-generated stream**

15. Out-of-scope findings surfaced by Amy, Stockwell, or retro shall be filable into the same intake funnel rather than discarded in report text.

### Non-Functional Requirements

1. Every item that appears on the kanban board shall be something the operator explicitly blessed (nothing un-gated reaches the board).
2. Correcting a bad draft shall require no database cleanup — revision re-comments/updates the proposal; DB state is only ever created at the gate.
3. Each promotion path shall have exactly one canonical state-holder; labels and folders that mirror it are convenience, not truth.
4. Capture shall function from a mobile GitHub client with no local tooling.

### Edge Cases & Error States

- **Triage mis-classifies weight.** Handled by the label escape hatch (§ use cases, FR-11) in both directions: light→heavy (`ateam:prd`) and heavy→light.
- **A drafted PRD is padding.** The operator collapses it during review; the item drops to the light track rather than shipping an over-specified document.
- **A drafted work-item proposal is wrong.** The operator comments; triage re-drafts. No DB rows exist yet, so there is nothing to roll back.
- **Item captured during an active mission.** It lands unattached in the backlog; it does not join the running mission unless explicitly drawn in.
- **Label applied to an issue triage never scoped.** Define behavior: does `ateam:ready` on an unscoped issue trigger scoping-then-promote, or is it rejected until `ateam:scoped`? (see Open Questions)
- **Duplicate / self-generated issue storm.** Amy filing many findings should dedupe against existing open intake issues (fingerprint-style) to avoid backlog flooding.
- **PR merged but items already exist / re-merge.** Promotion must be idempotent — merging (or re-running) must not create duplicate backlog items.
- **Backlog grows unbounded.** Stale unscoped intake needs an aging or review signal so the inbox does not silently rot.

## 7. Design Principles

- **Ratify, don't author.** Authoring intention is expensive; correcting a draft of your intention is cheap. Humans are far better at "no, not like that" than at exhaustive up-front specification. The PRD becomes something the operator ratifies, not writes. The right level of intention self-corrects: a too-thin seed produces a visibly wrong draft, and the correction supplies exactly the missing intent.
- **Tier by blast radius, not size.** The variable that determines how much intention must be on record is how wrong the agents could plausibly go. A three-line change to auth or billing deserves more ratified intent than a large mechanical rename. Size is one input to classification, not the classifier.
- **One door, two weights.** A single intake funnel with two exits (PR review for heavy, issue-comment ack for light), not two parallel capture systems.
- **Gate with GitHub-native events.** Both gates are things the operator already does from a phone: a merge and a label. Async, auditable, no bespoke UI.
- **Nothing on the board is unblessed.** Un-gated clutter stays in GitHub, where issue lists are built for triage. The DB and kanban hold only approved work.
- **Single canonical ready signal per path.** Two-sources-of-truth is where flows like this rot. For the heavy path the merge into `prd/ready/` is canonical; for the light path the `ateam:ready` label is canonical. Everything else mirrors.

## 8. Solution Approach

The system reframes a *mission* as a scoping event over a set of intake items, rather than the origin of work. Work originates upstream, asynchronously, as raw intent — and flows through a triage step that classifies and drafts, then waits at an explicit human gate.

**The funnel:**

```
                      GitHub Issue (raw intent)
                              │
                    ┌─────────┴─────────┐
             triage classifies by blast radius
                    │                   │
              HEAVY (PRD)           LIGHT (items)
                    │                   │
        headless agent drafts    triage drafts work items,
        PRD → branch → PR         posts as issue comment
                    │                   │
         operator reviews PR      operator applies
         (request changes /       `ateam:ready` label
          revise)                       │
                    │                   │
        merge into prd/ready/     items created in backlog
             = READY                 = READY
                    │                   │
                    └─────────┬─────────┘
                    blessed, unattached backlog
                              │
                    drawn into a mission
                (patrol run / planned sweep)
```

**Label state machine (light path):** `ateam:intake` (captured, untouched) → `ateam:scoped` (triage has posted a draft) → `ateam:ready` (operator blessed → items created). `ateam:prd` selects the heavy track and doubles as the escape hatch between tracks.

**Why GitHub can return without contradicting "DB is the record":** GitHub re-enters as the *capture and ratification surface* — cheap async input, mobile-friendly review, and a natural audit trail — while execution state stays in the ateam DB. The folder lifecycle already maps onto the heavy gate: `prd/drafts/` = open PR, `prd/ready/` = merged/blessed, `prd/completed/` = shipped. The merge is the event.

**Why the backlog is the linchpin:** because the schema already lets items exist unattached and survive mission archival, a persistent backlog outside missions dissolves the singleton-mission pain. Small blessed items wait *visibly on the board* instead of in the operator's head, and a patrol run assembles them into work when the board is quiet — which is what makes the label feel *live* rather than filing into a queue that only drains at PRD scale.

## 9. Technical Considerations

**Constraints:**
- Headless drafting must run under the validated `-p` headless mission machinery (see the July 2026 headless spike). Drafting a PRD or work items headlessly is strictly simpler than running a full mission, so this is a low-risk reuse.
- All DB writes remain project-scoped via `X-Project-ID`.
- Live SQLite DB must be migrated by additive `ALTER TABLE` (add a stage or an `scoped` flag), never by replacing the DB file.

**Dependencies:**
- A GitHub listener: a GitHub Action on `issues.labeled` firing a headless session, or a local/cron agent polling `gh issue list --label ...`. Choice affects latency and where secrets live (see Open Questions).
- The existing `MissionItem` overlay model and the `backlog` stage id — both already present.
- The `ateam` CLI as the capture/promotion executor.

**Integration points:**
- `POST /api/items` (already supports unattached creation) — the promotion gate calls this.
- `GET /api/board` and `deps-check` — must learn to separate scoped from unscoped intake.
- `createMission --force` archival — must continue to spare unattached backlog items (it already does; guard against regression).
- Amy / Stockwell / retro report generation — grows a "file as issue/inbox item" side-effect.

## 10. Risks & Open Questions

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Two-sources-of-truth drift (labels vs folder vs DB) | Medium | Flow rots, "ready" ambiguous | Commit to one canonical signal per path (Principle); mirror others read-only |
| Backlog becomes a junk drawer | Medium | Operator stops trusting it | Aging signal, dedup on self-generated issues, Inbox review view |
| Headless triage mis-scopes silently | Medium | Bad drafts waste review cycles | Escape-hatch relabeling; track rework/rejection as the scoreboard for triage quality |
| GitHub secrets / Action complexity | Medium | Fragile listener | Prefer local cron polling first if Action auth is heavy; decide deliberately |
| Un-gated intake leaks to board | Low | Board no longer "all blessed" | "No DB write before gate" as a hard invariant with a test |
| Self-generated issue storm | Low | Backlog flooding | Fingerprint dedup against open intake issues |

### Open Questions

- [ ] **Backlog representation:** a distinct `inbox` stage *before* `backlog`, or a `scoped: false` flag on items in `backlog`? (Affects board query, `deps-check`, and migration shape.)
- [ ] **Listener mechanism:** GitHub Action on `issues.labeled` (low latency, secret management) vs. local cron polling `gh` (simpler, higher latency, runs on operator's machine). The empirical scoreboard from the July headless spike suggests either is viable.
- [ ] **Drain trigger:** should a patrol mission self-assemble automatically once enough items are `ateam:ready`, or always be human-fired (`/ai-team:patrol`)? This dial most affects the daily *feel*.
- [ ] **`ateam:ready` on an unscoped issue:** trigger scope-then-promote in one step, or require `ateam:scoped` first?
- [ ] **Self-generated stream routing:** do Amy/Stockwell findings become GitHub issues (uniform funnel, dedup story) or direct inbox items (fewer hops, no GitHub round-trip)?
- [ ] **Canonical heavy-path signal:** confirm merge-into-`prd/ready/` over label as the source of truth (this PRD assumes merge).
- [ ] **Does capturing during a mission ever append to the running mission**, or always wait for the next one? (This PRD assumes always-wait; appending is a possible later affordance.)

## 11. Rollout & Measurement

**Phasing (order, not calendar):**

- **Phase 1 — Backlog foundation.** Add the unscoped/scoped distinction (stage or flag), the `ateam inbox add` capture verb, and the Inbox kanban view. Guarantee unattached items survive archival and never leak into `deps-check`. This is the smallest self-contained slice and unblocks everything else.
- **Phase 2 — Light path.** Triage agent + `ateam:scoped`/`ateam:ready` label machine + issue-comment drafting + label-gated promotion into the backlog. Delivers the "small stuff" win end-to-end.
- **Phase 3 — Heavy path.** Headless PRD drafting → branch → PR linked to issue → merge-into-`prd/ready/` gate. Reuses Phase 2's triage classifier for track selection.
- **Phase 4 — Self-generated stream + drain.** Route Amy/Stockwell/retro findings into the funnel; add the patrol/sweep drain mechanism.

**Measurement plan:**
- Track operator capture time and the share of inputs that never require a Claude session to capture.
- Track triage classification accuracy via downstream `rejection_count` and Amy findings on light-path items (the honest scoreboard for "was the intention level right").
- Review backlog age distribution to confirm the inbox drains rather than rots.

**Rollback criteria:** if gated promotion ever creates unblessed board items, or if the backlog leaks unscoped items into a running mission's ready list, pull the offending phase — those two invariants are load-bearing for operator trust.
