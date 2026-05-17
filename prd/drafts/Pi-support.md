---
missionId: ~
---

# Pi Support for A(i)-Team

**Author:** Josh  **Date:** 2026-05-12  **Status:** Draft

## 1. Context & Background

A(i)-Team is currently built around Claude Code plugin semantics: `.claude-plugin/plugin.json`, slash commands, agent markdown files, skills, Claude hook frontmatter, `Task`, `TaskOutput`, `TeamCreate`, `SendMessage`, and `TeamDelete`. The runtime has two orchestration modes:

- **Legacy mode:** Hannibal dispatches subagents and polls completion.
- **Native teams mode:** Hannibal creates long-lived named teammates, agents send direct handoff messages, and the `ateam` API/Kanban board remains the source of truth.

Pi Coding Agent is a viable second harness because it supports local and mixed-provider models, package extensions, skills, markdown agent prompts, and TypeScript event hooks. It is not a drop-in Claude Code replacement. Pi core is intentionally small, and capabilities such as subagents, inter-agent messaging, and file reservations come from packages/extensions.

Research into `pi-messenger@0.14.1` found that we can use part of it. Its direct messaging, presence registry, wakeup behavior, and optional file reservations map well to A-Team's native-teams handoff layer. Its Crew planner/task-board system duplicates A-Team's API and should not be adopted.

## 2. Problem Statement

A-Team cannot currently run a native Pi team. The shared assets are close to portable, but the runtime assumptions are Claude-specific:

- Claude Code `Task`/`TaskOutput` do not exist in Pi core.
- Claude Code `TeamCreate`/`TeamDelete` do not exist in Pi.
- Claude Code `SendMessage` must be replaced by a Pi messaging extension.
- Claude hook frontmatter does not execute in Pi.
- Claude hook stdin payloads do not match Pi extension events.
- Pi packages can provide subagent and messaging behavior, but these are not stable core primitives.

Without a Pi adapter, A-Team remains tied to Claude Code for native teams and cannot use Pi's local-provider or mixed-provider advantages.

## 3. Target Users & Use Cases

**Primary user:** an A-Team operator who wants to run the same PRD-to-code workflow through Claude Code or Pi without maintaining separate forks.

**Key use cases:**

- Run Hannibal and pipeline agents through Pi while preserving the existing `ateam` API/Kanban state model.
- Use local or cheaper provider models for selected agents while preserving Claude compatibility.
- Keep Murdock -> B.A. -> Lynch -> Amy peer handoffs in Pi native-teams mode.
- Use `pi-messenger` direct messages to wake named teammates, while A-Team owns lifecycle semantics such as `START`, `ACK`, `FYI`, `ALERT`, and timeout recovery.

## 4. Goals & Success Metrics

| Goal | Metric | Target |
|------|--------|--------|
| Preserve Claude compatibility | Existing Claude commands, agents, skills, hooks, and tests still pass | No regression |
| Prove Pi native-team handoff | Pi Murdock can hand off directly to Pi B.A. and receive ACK | One smoke mission path |
| Keep A-Team state authoritative | Work item status comes from `ateam` API, not Pi Crew files | 100% of stage transitions through `ateam` |
| Avoid prompt drift | Pi prompts are generated or shared from canonical A-Team assets | CI detects stale generated output if generated |
| Bound third-party dependency risk | `pi-messenger` is used only for transport/presence/reservation pieces | No dependency on Crew board/planner correctness |

## 5. Scope

### In Scope

- **Pi package surface** under a dedicated `pi/` or package directory, with `package.json` `pi.extensions` and `pi.skills` metadata as needed.
- **Pi harness adapter** that maps A-Team abstract operations to Pi:
  - `dispatch(agent, item)` -> Pi child process/subagent package behavior
  - `message(to, content)` -> `pi_messenger({ action: "send", to, message })`
  - `team_setup()` -> per-mission messenger namespace plus deterministic agent registration
  - `team_teardown()` -> agent `leave`/shutdown cleanup
- **Partial `pi-messenger` integration** for direct messages, presence/liveness, inbox wakeups, and optional file reservations.
- **Per-mission messenger isolation** using `PI_MESSENGER_DIR`, for example `/tmp/.ateam-pi-messenger/${ATEAM_MISSION_ID}`.
- **Deterministic Pi agent identity** using `PI_AGENT_NAME` values matching A-Team names: `hannibal`, `murdock-1`, `ba-1`, `lynch-1`, `amy-1`, and so on.
- **Lifecycle protocol on top of transport**: A-Team defines and validates `READY`, `START`, `ACK`, `FYI`, `ALERT`, `STATUS?`, and `SHUTDOWN` message semantics.
- **Hook bridge prototype** for at least one Pi `tool_call` write guard equivalent to an existing Claude hook.
- **Documentation** explaining supported Pi mode, tested Pi and `pi-messenger` versions, and known gaps.

### Out of Scope

- Adopting `pi-messenger` Crew planner, Crew task board, PRD task decomposition, or wave scheduler.
- Replacing the `ateam` API/Kanban board with `.pi/messenger/crew/` files.
- Treating Pi core as if it has built-in subagents or built-in peer messaging.
- Rewriting all Claude hooks in the first milestone.
- Full MCP parity.
- Assuming Stop-hook parity until Pi `agent_end` behavior is proven blockable enough for our lifecycle rules.

## 6. Requirements

### Functional Requirements

1. Pi support shall be additive. Existing Claude Code plugin behavior must remain intact.
2. The `ateam` API shall remain the source of truth for missions, work items, claims, stage transitions, dependencies, WIP limits, logs, and completion state.
3. Pi native-team mode shall use a per-mission `PI_MESSENGER_DIR` so unrelated projects and missions cannot see each other's registries or inboxes.
4. Each Pi teammate shall register with a deterministic `PI_AGENT_NAME` matching the A-Team instance pool name.
5. Each Pi teammate shall call messenger `join` and send a `READY` message before Hannibal marks that lane available.
6. Direct handoffs shall use messenger `send`, not messenger `broadcast`, for critical path messages.
7. Broadcast may be used only for non-critical FYI-style announcements after validating behavior outside `PI_CREW_WORKER` mode.
8. A-Team shall implement ACK and timeout logic above `pi-messenger`; messenger file delivery alone is not sufficient correctness.
9. Lifecycle messages shall not be blocked by `pi-messenger` coordination-level message budgets. The integration must configure a high enough budget or wrap/patch lifecycle sends separately.
10. `pi-messenger` file reservations may be exposed as an optional guard, but board claims and WIP limits shall remain enforced by `ateam`.
11. The Pi adapter shall spawn or attach teammates with enough extension/package configuration that every teammate has access to messenger and A-Team skills.
12. The first hook bridge milestone shall block at least one out-of-scope write/edit operation through Pi `tool_call`.
13. The Pi smoke test shall skip clearly when Pi is not installed.
14. The Pi smoke test shall verify at minimum: registration, direct message delivery, ACK, `ateam` state transition, and cleanup of the mission messenger directory.

### Non-Functional Requirements

1. The adapter should keep owned A-Team orchestration semantics small and explicit instead of hiding them inside a third-party Crew workflow.
2. Pi-specific generated files, if any, must be deterministic and traceable to source prompts/skills.
3. Error messages must name the harness (`pi`), teammate identity, mission ID, and failed adapter step.
4. The integration should pin and document the tested `pi-messenger` version.
5. The default path should be debuggable with normal filesystem inspection of the per-mission messenger registry and inboxes.

## 7. Proposed Architecture

### A-Team-Owned Layer

A-Team owns:

- mission lifecycle
- item lifecycle
- stage transition rules
- WIP and dependency enforcement
- agent role prompts and skills
- handoff protocol semantics
- timeout and recovery behavior
- hook/guard policy

### Pi Harness Layer

The Pi harness layer owns:

- starting Pi child processes or sessions
- registering deterministic agent names
- loading Pi package extensions/skills
- forwarding direct messages through `pi-messenger`
- translating Pi event payloads into A-Team hook-compatible inputs where practical

### `pi-messenger` Usage

Use these pieces:

- `join`, `leave`, `list`, `whois`
- `send` for direct peer messages
- inbox wakeups through Pi steering
- PID-backed active agent detection
- optional `reserve`/`release` file reservations

Do not use these pieces for v1:

- Crew planner
- Crew task files under `.pi/messenger/crew/`
- Crew wave scheduler
- Crew worker/reviewer role model
- Crew broadcast semantics for critical handoffs

The transport contract should stay narrow enough that A-Team can replace `pi-messenger` later if Pi gains native teams or a better official messaging primitive.

## 8. Compatibility Strategy

Keep one repository with harness-specific adapter surfaces:

| Concern | Claude Code | Pi |
|---------|-------------|----|
| Package metadata | `.claude-plugin/plugin.json` | `package.json` `pi.*` metadata |
| Commands | `commands/*.md` | Pi commands/package docs or adapter prompts |
| Agents | `agents/*.md` | shared or generated Pi-compatible agent files |
| Skills | `skills/*/SKILL.md` | shared skill directories or Pi package skills |
| Dispatch | `Task` / `TaskOutput` | Pi subagent/process adapter |
| Direct message | `SendMessage` | `pi_messenger send` |
| Team lifecycle | `TeamCreate` / `TeamDelete` | `PI_MESSENGER_DIR` + `join`/`leave` |
| Hooks | Claude hook scripts | Pi extension bridge |

Claude-specific files should remain valid for Claude. Pi-specific code should live beside them without forcing Claude prompts to degrade.

## 9. Validation Plan

- Unit test message formatting for `READY`, `START`, `ACK`, `FYI`, `ALERT`, `STATUS?`, and `SHUTDOWN`.
- Unit test Pi hook payload translation for one write/edit guard.
- Smoke test a per-mission messenger directory with two named Pi agents and a direct ACK.
- Smoke test one A-Team handoff path: Murdock success -> `agentStop --advance` -> direct START to B.A. -> B.A. ACK -> Hannibal FYI.
- Run existing repository tests to confirm Claude behavior remains unchanged.

Suggested commands will be finalized during implementation. The PRD requires equivalent coverage, not exact script names.

## 10. Risks & Open Questions

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| `pi-messenger` package API changes | Medium | Pi handoffs break | Pin tested version; keep a narrow wrapper |
| Message budget blocks lifecycle traffic | Medium | Agents fail to hand off | Configure high budget or bypass budget for A-Team lifecycle messages |
| Broadcast behavior differs under Crew worker mode | Medium | Hannibal misses critical events | Use direct messages for critical path |
| Pi child-process/subagent APIs remain extension-specific | High | Dispatch adapter churn | Isolate behind A-Team `dispatch` wrapper |
| Pi `agent_end` cannot block completion | Medium | Stop-hook parity gap | Use explicit `ateam` lifecycle validation and parent/Hannibal recovery |
| Agent identity differs in Pi hook payloads | Medium | Existing hooks misattribute events | Inject deterministic identity into bridge payload |

### Open Questions

1. Should Pi support start with native-team peer handoffs first, or a narrower parent-dispatch smoke test first?
2. Should the Pi adapter vendor a small wrapper around `pi-messenger`, or depend on the npm package directly with a pinned version?
3. What minimum Pi CLI version should be supported?
4. Should generated Pi agent files be committed for operator inspection or generated at install time?
5. Which existing hook is the best first bridge target: `block-murdock-impl-writes`, `block-lynch-writes`, or `enforce-agent-start`?
