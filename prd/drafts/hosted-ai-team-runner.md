---
missionId: ~
---

# Hosted AI Team Runner

**Author:** Josh / AI Team  **Date:** 2026-09-08  **Status:** Draft

## 1. Purpose

Run the existing AI Team plugin headlessly on a Podman host, with the Kanban API
holding durable state and an operator answering questions asynchronously. Start
with the runner required for issue-to-PRD drafting, then extend that foundation
to planning and full mission execution.

No local terminal should need to stay open. Waiting for an answer must not count
as an agent stall or failed mission. Reuse existing agents, skills, mission entry
points, TDD handoffs, and quality profiles rather than implementing another
orchestrator inside the worker.

## 2. Intake Boundary

[Async Intake & Triage](async-intake-and-triage.md) owns authorization semantics:

- Josh's request label starts clarification and PRD drafting.
- Josh's approval label starts Face → Sosa → Face breakdown.
- An authorized merge with a current completed plan queues execution.

The runner performs those jobs; it does not infer permission from arbitrary
labels or comments. Source-neutral job payloads allow a future Kanban-native
intake adapter without changing execution. Building that replacement intake UI
is out of scope, but Kanban question/answer support is in scope.

## 3. Scope

### In scope

- One Podman host, initially one execution mission per project.
- Durable clarify/draft, revise, plan, execute, and explicit recovery jobs.
- Headless Claude Code, pinned plugin revision and recorded model configuration,
  project tool/dependency setup, resource limits, logs, and available usage data.
- Persistent workspaces and safe recovery across disposable containers.
- API-backed questions with Kanban answers and GitHub conversation projection.
- Hannibal's existing healthcheck as the live-session answer path.
- Implementation branch/PR publication after normal verification and retros.

### Out of scope

Multi-host scheduling, multi-tenant SaaS, arbitrary public-repository execution,
concurrent missions within one project, automatic code-PR merge/deployment, new
pipeline algorithms, and a separate live worker-to-agent chat protocol.

## 4. Runtime and Job Contract

```text
GitHub intake / future Kanban intake
             ↓ authorized, revision-bound jobs
Kanban API + durable queue + questions
             ↕ lease / status / checkpoint
Podman worker → mission container → Claude Code / Hannibal
                                      ↕ existing team messaging
                               Face / Sosa / pipeline agents
```

1. Persist each job with project/repository, kind, source event/actor, immutable
   input revision, plan/mission reference where applicable, plugin revision,
   execution contract, and idempotency key. Store credential references, not
   secrets, in payloads.
2. Claim jobs atomically with leases and attempt IDs. Only the current attempt
   may update job state. Before replacing an expired attempt, stop its process
   or fence it from further writes; lease expiry alone must not allow concurrent
   writers in a mission checkout.
3. Run at most one execution mission per project. Planning candidates must not
   archive, modify, or attach work to the executing mission. If current APIs
   cannot isolate candidate planning, queue it until safe rather than using
   `createMission --force`.
4. Invoke existing plugin commands/playbooks. The worker owns process lifetime,
   leases, credentials, and artifacts; Hannibal owns agent orchestration. Track
   queued/running/waiting-on-operator/failed/cancelled/completed jobs separately
   from mission phase/state.
5. Bound retries and active runtime/spend according to project configuration.
   Cancellation stops the process, preserves partial state, and prevents new
   work. External side effects such as PR creation must be recoverable and
   idempotent across crashes.

## 5. Workspace and Security Contract

6. Give execution a dedicated checkout/implementation branch based on the
   approved merge commit. **Every lane agent shares that checkout**, including
   uncommitted tests and implementation. Omit the Agent tool's `isolation` key
   on initial spawns, retries, and resumes. Isolation is between missions, not
   between Murdock, B.A., Lynch, and Amy.
7. Persist workspace and required session/checkpoint artifacts outside the
   disposable container. Replacement containers require exclusive ownership.
   Do not delete uncommitted work after failure; expose retention/cleanup policy
   and recovery status to the operator.
8. Drafting jobs use an intake checkout and reuse the same PR branch across
   continuations. Execution uses a new implementation branch, never the merged
   PRD branch or direct pushes to the default branch.
9. Prefer rootless Podman on a supported host. Mount only the assigned workspace
   and required state, not the host home directory, unrelated repos, production
   DB files, or a container-management socket. Access Kanban through its
   authenticated, project-scoped API.
10. Inject least-privilege project/job credentials, redact logs, and limit
    outbound access to required services. Treat repository code and issue text
    as untrusted inputs, not authority to acquire credentials or change policy.
    Build/test code runs inside the restricted container, never the host event
    handler. Configure resources and network policy before accepting jobs.

## 6. Questions and Continuations

### Durable question service

11. Provide API operations to create/read questions, submit answers, fetch
    unconsumed answers, and acknowledge consumption. Records carry project,
    intake/mission/job, phase, asking agent/instance, question ID, prompt,
    optional choices, blocking flag, answer version, and delivery state.
    Always permit free text.
12. Only configured operators may resolve questions. Validate source identity
    and project/job association. GitHub and Kanban projections share one ID and
    history. Conflicting/stale answers require reconciliation, not silent
    overwriting of a newer decision.
13. Blocking questions suspend dependent work, not unrelated safe work. Retain
    the mission phase and a separate waiting-on-operator indicator. Do not guess
    answers or count human waiting as processing, stall, or rejection time.
14. Update headless agent instructions, including Sosa's, to call this service
    instead of terminal-only `AskUserQuestion`. Kanban displays asking agent,
    phase, question/options, and an answer action. Intake projects planning
    questions into the PR thread and maps replies to the canonical record.

### Live-session answer delivery through the heartbeat

15. Hannibal arms the existing self-wake during planning as well as execution.
    Current instructions schedule `/ai-team:healthcheck` at 1,500 seconds; extend
    its health-report response with unconsumed answers. Keep re-arming while the
    live session owns pending questions, including planning without items or
    blocked/staged items during the tail. Cancellation/completion stops the loop;
    an idle per-item pipeline must not hide a pending planning/tail question.
16. Make the interval configurable, initially 60 seconds while waiting for an
    operator and the existing 25 minutes otherwise. This is a polling target,
    not a latency guarantee when the model is busy. Avoid extra model-driven
    polling loops.
17. Hannibal forwards answers through existing team messaging to the asking
    agent. Acknowledge after the agent accepts the answer, not on report fetch.
    Deduplicate consumption by question ID and answer version; redelivery after
    a crash must be safe. If the agent is gone, preserve the answer until its
    authorized continuation is restored.
18. Distinguish the worker's process/lease heartbeat from Hannibal's model
    healthcheck. Worker health does not itself deliver tool results to an agent.
    This design does not require a separate live control channel for answers.

### When no session remains alive

19. Issue/PR drafting jobs checkpoint and exit while waiting; an accepted reply
    queues one continuation. Planning/execution may initially keep Hannibal
    alive. If that session exits or an idle policy stops it, route answers into
    an authorized resume job. A timer inside a dead process cannot wake it.
20. Recover using API state, pinned inputs, and saved workspace/session artifacts.
    Check completed steps before repeating them. If safe recovery cannot be
    established, report a blocked job with the reason; do not silently rerun
    the mission or discard changes.

## 7. Execution and Publication

21. Validate provenance, then consume the approved plan and quality profile from
    its merge commit. Do not independently regenerate decomposition on execution.
22. Preserve the existing TDD pipeline, reviews/probing, contract-driven mission
    tail, postchecks, commits, and retro. Successful process exit alone is not
    mission completion; required gates must have succeeded.
23. Publish one implementation branch/PR linked to issue, PRD PR, and mission.
    Leave code merge/deployment to the operator. Publication failures are visible
    and retryable without rerunning finished coding stages; distinguish verified
    mission work from completed publication.
24. Expose phase, attempt, source revision, workspace/branch, worker contact,
    last agent activity, pending questions, check results, failures, and artifact
    links. Report active runtime and operator wait separately, plus model
    usage/cost when available. Retros must distinguish human waits from agent
    slowness and avoid treating absent heartbeat activity as proof of lost telemetry.

## 8. Acceptance Criteria

- [ ] A labeled-issue job clarifies, checkpoints, survives worker restart, and
  resumes from an answer to create one PRD PR without an interactive terminal.
- [ ] Planning uses Face/Sosa/Face; Sosa receives answers from GitHub or Kanban
  without a terminal prompt or independent conflicting answer stores.
- [ ] A live Hannibal delivers answers from the health report; repeated reports
  and a crash before acknowledgment neither lose nor apply an answer twice.
- [ ] Planning without items and blocked/tail phases retain answer delivery.
  Cancelled/completed jobs do not wake forever.
- [ ] A stopped session resumes through the queue on an answer, independently
  of timers in the terminated process.
- [ ] A merged revision-matched plan executes once. A second mission waits
  without altering the first; lease recovery cannot create concurrent writers.
- [ ] B.A. sees Murdock's uncommitted test, and Lynch/Amy see B.A.'s uncommitted
  implementation on initial spawn and recovery, without per-agent worktrees.
  Separate missions cannot access one another's workspace.
- [ ] Container termination preserves work and exposes a safe continuation or
  an explicit blocker, not a blind restart.
- [ ] Cross-project answers and unauthorized events are rejected. Secrets are
  absent from durable payloads and published logs.
- [ ] One tiny end-to-end mission completes configured verification/retro and
  opens one implementation PR, reporting active time separately from human wait.

## 9. Delivery and Verification

1. **Runner foundation + PRD drafting:** queue/lease, one image, scoped credentials,
   persistent intake state, issue questions, and continuation. Deliver alongside
   intake's first slice, not after full hosted execution.
2. **Planning:** question API/Kanban view, GitHub projection, headless prompt
   changes, heartbeat answers, and isolated candidate plans.
3. **Execution:** merge handoff, shared checkout, existing pipeline, recovery,
   implementation PR publication, and operator status.

Use deterministic tests for authorization, queue ownership, revision matching,
answer replay, and state transitions. Add container smoke checks for workspace
sharing and interruption, then one small real end-to-end mission. A broad paid
prompt benchmark is not required to ship the runner foundation.

## 10. Decisions Before Deployment

- Select host, credentials, repository allowlist, resource/runtime/spend limits,
  and workspace retention policy.
- Pin and verify the actual Claude Code/plugin build in the image: headless
  teams/messaging, `ScheduleWakeup`, and session resume. Playbook descriptions
  are not proof of deployed capabilities; failed checks must block launch visibly.
- Choose event transport with intake. No separate WebSocket control service is
  required for the proposed durable-job/API-response design.
- Select idle-session retention after measuring waiting cost. Polling and a
  kept-alive process are not durability guarantees; persisted questions and
  recovery are.

Disable new admissions if authorization or exclusive workspace ownership fails.
Preserve current work and logs; never recover by replacing the database or
deleting a mission checkout.
