# Spike: Native agent-teams under `claude -p` (headless)

**Date:** 2026-07-13
**Status:** Complete — fix implemented on branch `feat/pool-agentid-handoff` (CLI + skills + playbook); end-to-end confirmation pending the token-reset headless mission
**Context:** De-risking the "run the A(i)-Team in a container via `claude -p`, monitor via the Kanban viewer" idea. The gating unknown was whether native teams mode (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS`) — specifically its peer-to-peer handoffs (Murdock→B.A.→Lynch→Amy) — actually functions in headless print mode.

## TL;DR

Teams mode **runs headless**, but with a sharp constraint that directly threatens the plugin's pipeline:

- ✅ Spawning **named background teammates** works under `-p`.
- ✅ Teammate → **lead** (`main`) messaging is delivered reliably (surfaces via `task_notification`).
- ⚠️ Teammate → **teammate** messaging works **only when addressed by the harness `agentId`**. Addressing a peer by its **friendly name** (the name given at spawn) is **accepted by the sender but silently dropped** — the target never receives it.

**Implication:** the plugin's native handoffs will run headless **only if they carry the real `agentId` of the next agent**. If any handoff addresses a peer by pool/instance name (e.g. `ba-1`, `lynch-1`), it will silently stall headless — the same failure class as the stale-`hannibal`-address bug fixed in PR #46. This must be verified against the real pool/messaging layer before committing to native-teams-only in a container.

## Environment

- `claude` CLI **2.1.207**
- Teams enabled via env: `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` (no CLI flag; env toggle only)
- Invocation: `claude -p <prompt> --output-format stream-json --verbose --dangerously-skip-permissions --model sonnet`
- Each probe capped with `timeout 300`. No `--max-turns` flag exists in this build; scope was bounded by prompt + timeout.
- Total spike cost: **≈ $4.29** across all sessions (4 probes, lead + teammates).

## Method & Results

Three probes, each a nested `claude -p` "team lead" that spawns teammate(s) and attempts a message round-trip. Output captured as `stream-json` so spawn/message/lifecycle events are directly observable.

| # | What it tested | Result |
|---|----------------|--------|
| A | Lead spawns one teammate (`scout`); scout messages the lead | **PASS** — `teams_tools=yes spawn=ok peer_message=received` |
| B | Teammate `alice` messages teammate `bob` **by name** | **FAIL** — `alice_to_bob=failed lead_got_relay=no` |
| C | Teammate `alice` messages teammate `bob` **by real `agentId`** | **PASS** — `alice_to_bob_byID=delivered lead_got_relay=yes` |
| D | Can a teammate discover **its own** agentId (to self-register)? | **NO** — `agent_can_self_identify=no`; only session vars in env, no agentId |

### Evidence that Probe A is real (not the model roleplaying both sides)

The lead's `Agent` call returned a genuine background teammate — real `agentId`, its own task-output transcript, and `task_started` / `task_notification` lifecycle events. Scout's message arrived addressed `to: "main"` with body `START: probe-ack from scout` (a session does not address itself as `main`).

### Evidence that Probe B's failure is name-resolution, not liveness

Task notifications, in order:
- bob: *"Waiting to receive a message from another teammate."* (bob stayed alive — **not** an ephemeral-exit artifact)
- alice: *"Message sent to bob: `HANDOFF: alice->bob direct`. Task complete."* (sender side reported success)
- bob (on lead's status-check): *"I received nothing from teammate 'alice'... I remain waiting to receive a SendMessage."*

Sender succeeded, receiver got nothing, receiver was alive throughout → **silent drop on a name-addressed peer message.**

### Evidence that Probe C isolates the cause to addressing

alice sent `SendMessage to: "a729de7264069a126"` (bob's real `agentId`). Notification: *"SendMessage to `a729de7264069a126` … succeeded — it resumed a previously-stopped agent with that ID."* bob then relayed `RELAY_OK: HANDOFF: alice->bob byID` to `main`, and the lead received it.

→ Peer delivery works by `agentId` (even resuming a stopped agent to receive). The only difference from the failing Probe B is name-vs-ID addressing.

### Evidence for Probe D (an agent cannot self-identify)

Teammate `solo` ran `env | grep -E '^(CLAUDE|AGENT|TASK|TEAM)'` and found only session-level vars (`CLAUDE_CODE_SESSION_ID`, `CLAUDE_CODE_CHILD_SESSION`, `CLAUDE_CODE_ENTRYPOINT`, `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS`, …) — none is the `a…`-format agentId used for teammate addressing, and no agentId appeared in its spawn-time context. It reported `SELF_ID: id=NONE source=none`.

→ The chicken-and-egg is real: the lead learns a child's agentId only in the `Agent` **return value** (after the child's prompt is already sent), and the child has no way to read its own agentId. **So the agentId registry cannot be self-written by the agent — the lead must write it.**

## Findings

1. **Headless teams mode is viable.** Named background teammates spawn and run under `-p`; the lead orchestrates them.
2. **The lead is the reliable hub.** Anything addressed to `main` is delivered. This maps cleanly to the plugin's "Hannibal receives FYI/ALERT" model.
3. **Peer-to-peer requires `agentId`, not name.** Friendly names assigned at spawn are **not** a cross-teammate routing key in headless mode. Only the spawning lead holds the name→ID map; peers don't, so a peer's name-addressed message resolves to nothing and is dropped **silently** (no error to the sender).

## Implications for the container plan

- The plugin's native pipeline depends on **teammate→teammate** handoffs (Murdock→B.A.→Lynch→Amy, with Hannibal only on FYI/ALERT). Per finding #3, those handoffs succeed headless **iff** the sender addresses the next agent by its `agentId`.
- The plugin's pool layer (`ateam pool …`, `${POOL_DIR}/${TYPE}-*.idle`, `claimedNext` from `agentStop`) is the registry that would supply cross-peer identity. **The open question is whether that layer threads harness `agentId`s or only friendly instance names** (`ba-1`, `lynch-1`). If the latter, native handoffs stall silently headless.
- This is the **same failure class** as the stale-`hannibal`-address bug fixed in PR #46 (message accepted, silently never delivered). That the plugin already had one such bug reinforces that peer routing is the fragile surface to verify headless.

## Proposed fix: agentId in the pool marker (lead-written at mark-idle)

**Confirmed against the code** (`packages/ateam-cli/cmd/`): the pool is a filesystem dir `/tmp/.ateam-pool/$ATEAM_MISSION_ID/` of **empty marker files** named `<instance>.idle|.busy` (`pool_mark-idle.go:60` does `os.Create`+`Close`, no content). The handoff in `agents-stop_agentStop.go` computes `claimedNext` from the marker **filename** (`claimIdleInstance` returns `base`, line 67-74) → `data.claimedNext = "ba-2"` (`injectPoolResult`, line 143) → the teams-messaging skill sends `SendMessage(to: "ba-2")` (skill line 210). Friendly-name address → silent drop headless (Probe B). Per Probe D the agentId **cannot be self-written** by the agent; the **lead writes it**, which fits because Hannibal already runs `ateam pool mark-idle <instance>` after each agent's READY (playbook lines 259/354/1210) and already holds each agentId from the `Agent` spawn return at that exact moment.

The change threads one string through the seam that already exists — the atomic claim primitive (hardlink/rename races, exit codes) is untouched:

1. **CLI** `pool_mark-idle.go`: add `--agent-id <id>`; write it as the marker file's content instead of leaving it empty (`f.WriteString(id)`).
2. **CLI** `agents-stop_agentStop.go`: `claimIdleInstance` reads the marker content before the `.idle`→`.busy` rename and returns `(name, agentId)`; `injectPoolResult` adds `data.claimedNextAgentId`.
3. **Skills** (`teams-messaging`, `pool-handoff`, `agent-lifecycle`): address the START to `claimedNextAgentId`, not the friendly name.
4. **Playbook** (`orchestration-native.md`): Hannibal captures each spawned agent's agentId from the `Agent` return and passes `--agent-id` to that instance's `mark-idle` call.

Low-risk properties: `rename` preserves marker content, so the agentId rides through `.idle`↔`.busy` claim/release for the instance's life; Probe C showed the agentId is stable across stop/resume, so it's registered once and valid forever (lazy respawn re-runs `mark-idle`, re-capturing the new id); and if `--agent-id` is omitted the marker is empty and the handoff falls back to the friendly name — identical to today's behavior. Needs no further probe to trust: the lead demonstrably holds every agentId (spike) and agentId-addressed delivery works (Probe C).

## Next steps (verify with the real plugin, once tokens reset)

1. **Trace the current pool/messaging identity.** Confirm what `claimedNext` and the pool `.idle` registry carry today (agentId vs name) and what a peer handoff currently passes to `SendMessage(to: …)` — i.e. how big the change in the "Proposed fix" section actually is.
2. **Implement the agentId registry** (steps 1–4 above) if handoffs are name-addressed.
3. **Run one instrumented 2-item mission headless** (`claude -p` + `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`) and confirm Murdock→B.A.→Lynch→Amy handoffs actually land (board advances through every stage), not just that the mission starts.

This spike removes the "does teams mode even work headless" unknown (it does), identifies the exact defect (name-addressed peer sends drop silently), and specifies a concrete fix (lead-written agentId registry). The remaining work is implementation + one end-to-end confirmation.

## Reproduction

Prompts and raw `stream-json` transcripts for all three probes are in the session scratchpad (`scratchpad/spike/`): `probe-prompt.txt` / `probe-out.jsonl` (A), `p2p-prompt.txt` / `p2p-out.jsonl` (B), `p2p-id-prompt.txt` / `p2p-id-out.jsonl` (C). Each was run as:

```bash
CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 timeout 300 claude -p "$(cat <prompt>)" \
  --output-format stream-json --verbose --dangerously-skip-permissions --model sonnet
```
