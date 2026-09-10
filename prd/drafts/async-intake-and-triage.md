---
missionId: ~
---

# Async Intake & Triage

**Author:** Josh / AI Team  **Updated:** 2026-09-08  **Status:** Draft

## 1. Purpose

Let Josh capture an idea in a GitHub issue, clarify it asynchronously, review an
agent-written PRD, and authorize planning and execution separately. No local
Claude session should be required to move work through these gates.

The plugin now has different entry points for PRDs, bug fixes, reviews, and bug
stomps. This PRD adds asynchronous intake around those processes, rather than
replacing their decomposition logic or the interactive `write-prd` workshop.

**Request label = clarify and draft. Approval label = plan. Merge = build.**
Label names below are proposed configurable defaults, not Git tags.

## 2. Operator Workflow

1. Josh opens an issue and applies `ateam:prd`.
2. The writer reads the issue and relevant repository context, asks questions
   on the issue, and continues the back-and-forth until draft-blocking questions
   are resolved. Do not create the PRD branch or PR before that point.
3. The writer creates a branch, writes the PRD, and opens a linked PR. Scale the
   document to the work rather than padding it to a fixed size.
4. The system posts and maintains a PR-thread summary of remaining open
   questions, options, recommendations, and assumptions. Josh answers or requests
   revisions there; the writer updates the same PRD and PR.
5. Josh applies `ateam:approved` to the PR. This starts Face → Sosa → Face work
   breakdown, **not code execution**. Sosa may ask additional planning questions;
   surface them in the PR thread through the shared question service.
6. When planning is complete, the PR contains the final PRD under `prd/ready/`,
   a work-item/dependency summary, the ratified quality profile, and a successful
   breakdown check tied to the final revision.
7. Josh reviews those outputs and merges into the configured default branch.
   That merge queues execution of the approved plan. If another mission is
   running, this one waits; nothing is implicitly archived or interrupted.

```text
Issue + request label → issue questions → PRD branch + PR
    → PR questions/revisions → approval label
    → Face / Sosa / Face + planning questions
    → final PRD + work breakdown → authorized merge → execution queue
```

## 3. Scope and Ownership

### Initial delivery

- GitHub conversation, operator authorization, revision tracking, and the heavy
  PRD path above.
- A writer role/adapter reusing existing PRD-authoring guidance.
- Durable intake, questions, approvals, and candidate plans. Candidate work can
  exist before merge but cannot be claimed for code execution.
- Minimal headless clarification/drafting/revision/planning jobs, using the
  foundation in [Hosted AI Team Runner](hosted-ai-team-runner.md).
- An idempotent execution enqueue handoff after a qualifying merge.

This PRD owns **conversation and approval semantics**. The companion owns
**Podman processes, jobs, recovery, API questions, and execution workspaces**.
The minimal runner is an initial dependency delivered alongside intake, not an
assumption deferred until full mission hosting. Do not build two separate runners.

### Preserved follow-on scope

The earlier draft's light path remains planned, but must not delay the PRD path:

- Triage classifies by ambiguity and blast radius, not size alone. The operator
  can switch tracks without recapturing intent.
- For small work, triage posts proposed work items on the issue. Josh applies
  `ateam:ready` to approve that exact proposal into an unattached backlog. This
  does not independently authorize code execution.
- `ateam inbox add` captures raw intent without disturbing an active mission.
  Raw intake is a separate record, not an executable work item.
- A Kanban Inbox view separates unapproved intake from execution-board work.
  Approved backlog survives mission turnover and can be explicitly drawn into
  a mission; automatic patrol/drain policy remains deferred.
- Amy, Stockwell, and retro findings can enter the same funnel, deduplicated by
  source/fingerprint, rather than being lost in report text.

### Out of scope

Automatic approval/merge, third-party intake adapters, multiple concurrent
execution missions per project, and a full Kanban-native replacement for GitHub
intake. The runner still provides Kanban questions for planning/execution.

## 4. Functional Requirements

### Authorization and event handling

1. Accept issues containing only a title and body. Start drafting only when the
   configured operator identity (Josh initially) applies the request label.
   Verify the authenticated event actor, not just label presence. Apply the same
   rule to planning approval and light-path promotion. This restricts automation
   even if another user can physically apply a GitHub label.
2. Bind every action to its repository/project, source event, actor, and input
   revision. Deduplicate event deliveries and suppress bot-comment feedback
   loops. Comment text and repository content cannot grant permissions.
3. Only configured authorized mergers can authorize execution; Josh is the sole
   initial operator. An unauthorized merge or bypassed/missing readiness check
   must visibly refuse enqueue rather than silently execute.

### Questions, drafting, and revisions

4. Ask identifiable, concise questions with choices and recommendations when
   useful, always allowing free text. Persist pending questions and accepted
   answers. Do not invent missing requirements to escape a waiting state.
5. Distinguish questions blocking a useful draft from decisions best reviewed
   alongside a draft. Resolve the former on the issue before branch creation;
   list the latter in the PR. A headless job must not wait on a terminal-only
   question prompt.
6. Issue/PR drafting jobs checkpoint and exit while waiting. An authorized reply
   or revision request queues continuation from the durable conversation. Other
   commenters provide context, not operator decisions. No model process needs
   to stay alive throughout an issue conversation.
7. Maintain one active drafting branch/PR per intake record and reuse it on
   retries. Summarize revisions, unresolved decisions, and next actions. Closing
   an issue/PR without proceeding cancels pending jobs; reopening requires an
   explicit operator request to resume.

### Approval starts breakdown

8. On the approval-label event, snapshot the PR head and PRD content revision
   and enqueue one breakdown for that approval. Reject approval with an explanation
   if known planning-blocking questions remain unresolved.
9. Run existing Face → Sosa → Face planning and the quality recommendation/
   ratification gate. Persist a stable plan identity/revision, work items,
   dependencies, PRD reference, and execution contract. Do not dispatch Murdock
   or B.A. in this job.
10. Sosa asks through the shared API question service. Project those questions
    into the PR thread and route authorized replies to their canonical question
    IDs. GitHub and Kanban must not hold independent answer histories.
11. Publish the work breakdown, resolved decisions, and quality profile on the
    PR. The completion check binds the final PR head, PRD content revision, and
    plan revision. Waiting/failed planning is not execution-ready.
12. Approval is an event, not a permanently reusable label. A subsequent operator
    edit to the PRD requires reapproval and refreshed planning. Planning-generated
    refinements are allowed under the planning authorization, but must produce
    a plan/check matching their final revision. Any new head invalidates the old
    check until reconciliation; unrelated edits need not force fresh planning
    if the system verifies unchanged plan inputs. No stale green check carries
    authority to a newer head.

### Merge starts execution

13. Enqueue execution only for a tracked PR merged into the configured default
    branch with completed breakdown, no blocking questions, and a final ready
    PRD whose content matches the plan. The successful check must match the
    merged PR head. Record the merge commit as execution base; support squash/
    rebase using provenance and content rather than assuming head and merge SHAs
    are identical.
14. Reuse the approved plan/items. Do not decompose again on merge. Dedupe enqueue
    by intake/plan revision and merge event; retries cannot duplicate jobs,
    missions, or work items. An ordinary merge containing an old ready PRD, an
    untracked PR, or a closed-unmerged PR is not an execution trigger.
15. Publish queued/running/blocked/completed status and a mission link. Merge
    means authorized and queued, not necessarily started. Never displace an
    active mission with forced mission creation.

## 5. Persistence and State Boundaries

Intake phases: `clarifying → drafting → prd_review → planning → awaiting_merge
→ execution_queued`. Record waiting-on-operator, failed, and cancelled separately
while retaining the phase to resume.

GitHub is the conversation/approval surface; the API stores durable workflow and
execution state. Labels and comments mirror it, not independently override it.

**The boundary is execution eligibility, not whether a DB record exists.** Raw
intake and candidate plans may be persisted before approval/merge. They must not
leak into `deps-check`, pool dispatch, or an unrelated active mission. Implement
schema changes through migrations that preserve existing data, never replacement
of the live database.

## 6. Acceptance Criteria

- [ ] Josh's issue label starts clarification; another actor's identical label
  does not. Duplicate authorized events launch one logical job.
- [ ] Two issue-question rounds survive runner restart. Only after blocking
  answers arrive does one branch and one linked PR appear.
- [ ] PR comments expose open questions/options and revise the same PRD without
  starting implementation.
- [ ] Approval runs Face/Sosa/Face once, handles Sosa's questions asynchronously,
  and publishes work items, dependencies, and a ratified quality profile.
- [ ] No candidate item can be claimed for execution before merge, including
  while another mission is active.
- [ ] Edits invalidate stale approval/readiness. Planning refinements generate
  a matching final plan/check without requiring an endless approval cycle.
- [ ] A valid authorized merge enqueues once using the existing plan and merge
  commit. Replayed events duplicate no jobs, missions, or items.
- [ ] Premature, unauthorized, wrong-target, untracked, and closed-unmerged PR
  events start no execution and explain refusals needing operator action.
- [ ] The flow works without an interactive terminal and separates human waiting
  from active drafting/planning runtime.

## 7. Delivery and Open Decisions

1. Runner foundation, authenticated events, durable issue clarification, and
   PRD branch/PR creation: the first useful end-to-end delivery.
2. PR revisions, approval-triggered breakdown, and asynchronous Sosa questions.
3. Revision-bound merge gate connected to hosted execution.
4. Light-path backlog, CLI capture, self-generated findings, and explicit drain.

Choose event transport (webhook receiver or authenticated event polling),
credentials, host, and final label names before implementation. Either transport
must retain event actor identity; polling current label presence is insufficient.
Follow-on backlog representation and automatic drain are not heavy-path blockers.

Measure active runtime, operator waiting, duplicate suppression, and downstream
rework separately. Zero rejections alone does not prove quality. Disable automatic
enqueue if authorization, revision matching, or pre-merge dispatch isolation fails.
