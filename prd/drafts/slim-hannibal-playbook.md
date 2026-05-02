---
missionId: ~
---

# Slim Hannibal Playbook with On-Demand Edge-Case Skills

**Author:** Josh  **Date:** 2026-05-01  **Status:** Draft

## 1. Context & Background

Hannibal's coordination cost is the largest single line item in a typical mission. In the most recent reference mission (M-20260430-001, six work items, ~$74 total), Hannibal alone consumed ~$24 — about a third of the mission. The dominant driver isn't *thinking*; it's repeated cache reads of a 1,100-line orchestration playbook that sits in Hannibal's context for the entire run, paid for on every one of the ~200 turns the orchestration loop takes.

Roughly 85% of that playbook is exception and recovery procedure — resume recovery after a crashed session, lane-failure cascades, ALERT-handling, dispatch-timeout respawn, pool-corruption recovery, worked examples. Most missions never consult any of it. Yet every mission pays cache-read cost for it, every turn.

**Why now.** Mission frequency is growing. As the volume of A(i)-Team work scales, Hannibal's per-mission overhead becomes the dominant cost lever — and the easiest one to pull. Other cost reductions (model selection, agent skill optimization) require deeper changes; this one is structural and applies to every mission going forward.

## 2. Problem Statement

Hannibal pays cache-read cost for the entire 1,100-line orchestration playbook on every turn of every mission, but consults only the ~15% of it that describes steady-state operation. The remaining 85% — resume recovery, lane-failure cascades, ALERT recovery, dispatch-timeout respawn, worked examples, and pool-corruption recovery — is dead weight in context that inflates Hannibal's per-mission cost without contributing to the work.

## 3. Target Users & Use Cases

**Primary users:**

- **A(i)-Team operators** running missions through Hannibal — they pay the marginal token cost on every run, and Hannibal's bloat is currently the largest avoidable line item.
- **Plugin maintainers** who extend or refine Hannibal's behavior — a slimmer core is easier to read, modify, and verify.

**Key use cases:**

- An operator runs `/ai-team:run` on a normal-path mission and pays only for the orchestration content Hannibal actually consults.
- An ALERT fires mid-mission; the recovery procedure loads on demand, runs, and Hannibal returns to the steady-state loop without permanently expanding context.
- A maintainer adds a new edge-case path (e.g., a new BLOCKED handling routine) without expanding the always-loaded core.
- A mission is resumed after a session crash; the resume-recovery procedure loads, rebuilds state from the API, and hands control back to the slim core.

## 4. Goals & Success Metrics

| Goal | Metric | Current | Target |
|------|--------|---------|--------|
| Reduce Hannibal per-mission cost | Hannibal `estimatedCostUsd` on a 6-item baseline mission | ~$24 | < $12 (≥50% cut) |
| Shrink Hannibal's persistent context | Lines of always-loaded orchestration material | ~1,100 | < 250 |
| Preserve correctness | Mission completion rate end-to-end | 100% | 100% |
| Avoid skill thrash | Mean extracted-skill loads per mission | N/A | ≤ 1 (most missions trigger zero) |

**Must NOT degrade:**

- Mission wall-clock from `/ai-team:run` to `MISSION_COMPLETE`
- Recovery success rate when ALERT, dispatch-timeout, or BLOCKED fires
- Operator readability of the orchestration flow (someone reading the slim core should be able to trace a normal-path mission end-to-end without opening any skill)

## 5. Scope

### In Scope

- A new slim core playbook (`playbooks/orchestration-native-core.md`, < 250 lines) covering only steady-state orchestration: the loop phases, dispatch helper, FYI/ALERT/MISSION_COMPLETE handlers, completion detection, lazy-spawn trigger condition, and references to the extracted skills.
- At minimum three on-demand skills with auto-triggering descriptions:
  1. Resume recovery — triggers on mission state `running` at startup with existing claims.
  2. ALERT recovery — triggers when Hannibal receives an ALERT message from a pipeline agent.
  3. Dispatch-timeout respawn — triggers when 60s passes after a dispatch with no ACK or FYI.
- Extraction of the lane-failure cascade and pool-corruption recovery procedures into skills (separate or combined — see Open Questions).
- Removal of the worked N=2 example from the always-loaded core (moved to a reference file or deleted).
- An updated `/ai-team:run` skill flow that loads the slim core when `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`.
- A baseline-mission verification pass: re-run a representative mission after the change and confirm the cost-reduction target is met without regressing completion rate or wall-clock.

### Out of Scope

- Moving Hannibal off Opus or onto a smaller model — separate cost lever, already partially addressed by the `/ai-team:run` model check.
- Rewriting any per-stage agent skill (Murdock, B.A., Lynch, Amy, Stockwell, Tawnia, Retro).
- Behavioral changes to the legacy single-instance playbook (`orchestration-legacy.md`) beyond its loading strategy — same splitting *principle* may apply but is deferred to a follow-up PRD.
- A generalized framework for skill-extraction across other large skills/playbooks. This PRD targets Hannibal's playbook specifically; generalization can come once the pattern is proven.

## 6. Requirements

### Functional Requirements

1. The plugin shall ship `playbooks/orchestration-native-core.md` containing only the steady-state orchestration loop (Phase 1, 1b, 2, 3, 4), the dispatch helper signature, the FYI / ALERT / MISSION_COMPLETE / BLOCKED message handlers, the completion-detection rule, and the lazy-spawn trigger condition. The file shall be no more than 250 lines.

2. The plugin shall ship at least three on-demand skills, each with an auto-triggering description appropriate to its activation signal:
   - **Resume recovery skill** — triggers when Hannibal starts a mission whose API-reported state is `running` and the team is empty (session was lost).
   - **ALERT recovery skill** — triggers when Hannibal receives an ALERT message from a pipeline agent.
   - **Dispatch-timeout respawn skill** — triggers when 60 seconds elapse after a dispatch without an ACK, FYI, or `teammate_idle` event from the dispatched instance.

3. The slim core shall reference each extracted skill by name with a one-line summary of when to invoke it, rather than inlining the procedure.

4. `/ai-team:run` shall, when `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`, load `orchestration-native-core.md` instead of the current `orchestration-native.md`.

5. Each extracted skill shall be self-contained: when triggered, it shall provide the complete procedure for its scenario without requiring Hannibal to re-read the slim core for context.

6. The lane-failure cascade procedure (currently embedded in the Agent Pre-Warming section) shall be extracted into its own skill, triggered when `wait_for_lane_ready` returns fewer than 4 confirmed READY agents.

7. The N=2 worked example currently in the playbook shall be removed from the always-loaded core and either moved to a documentation reference file or deleted.

8. The pool-corruption recovery procedure shall be extracted into a skill triggered on observed pool/board state divergence (e.g., an item assigned to an agent whose pool slot is `.idle`, or vice versa).

9. A short BLOCKED-handling rule shall be promoted in the slim core to be a hard interrupt — Hannibal shall acknowledge a BLOCKED message immediately, query state, and route to the appropriate recovery skill rather than treating BLOCKED as informational. (This addresses a process gap surfaced in M-20260430-001 retro.)

### Non-Functional Requirements

1. Skill triggering shall be reliable: when Hannibal observes the trigger condition described in a skill's description, the skill shall load before Hannibal proceeds with the affected operation.

2. Skill loading shall preserve the steady-state loop's invariants. Once an extracted skill returns, Hannibal shall resume the loop at the next iteration without losing tracking state (`active_instances`, `pending_alerts`, `next_lane_to_spawn`, `failed_lanes`).

3. The slim core shall remain readable end-to-end as a procedural document — an operator reading only the slim core shall be able to trace Hannibal's normal-path behavior from `/ai-team:run` to `MISSION_COMPLETE` without consulting any extracted skill.

4. Cache-creation cost of any extracted skill shall not exceed the steady-state cache-read savings within a single typical mission. As a working rule: skills under ~3,000 tokens may trigger on up to ~5% of missions and remain net-positive; larger skills must trigger on a smaller share to break even.

5. Each extracted skill shall declare, in its description, the loop-state variables it expects to find in Hannibal's context and the variables it may modify on return. This contract makes the boundary explicit and auditable.

### Edge Cases & Error States

- **Trigger miss.** A skill description fails to fire when its condition arrives (e.g., model variance, ambiguous trigger phrasing). Without ALERT recovery loaded, Hannibal cannot dispatch a queued item. Mitigation: a brief, intentionally-incomplete inline fallback in the slim core that handles the trivial case ("queue the item, log a warning, continue") so the mission degrades gracefully instead of stalling.

- **State leak between core and skill.** A skill references a loop variable the slim core no longer maintains, or vice versa. Mitigation: each extracted skill declares its expected and modified state in its description (NFR 5); review during extraction.

- **Two skills trigger on overlapping signals.** Resume-recovery and pool-corruption-recovery may both look applicable on a fresh start with stale pool files. Mitigation: precedence is documented in the slim core (resume first, then pool); skills check whether the precondition still holds before acting.

- **Loop-evolution drift.** A future change to the steady-state loop creates a new edge case. Default rule recorded in the playbook: extract if the procedure is ≥ 50 lines AND triggers on < 20% of missions. Otherwise inline.

- **Legacy playbook fallback.** A user runs `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS != 1` and falls through to the legacy playbook. That path is unchanged in this PRD — same splitting principle may be applied later, but operators on the legacy path see no improvement until then.

- **Skill-loading cost on short missions.** A mission with only one or two work items may be fully complete before any extracted skill becomes net-positive. Acceptable: short missions are inexpensive overall, and the *floor* on Hannibal's cost is what we're trying to lower, not the absolute cost on a tiny job.

## 10. Risks & Open Questions

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Skill descriptions trigger unreliably under model variance | Medium | Mission stalls when an exceptional path fires and the skill doesn't load | Inline fallback in the slim core covers the trivial case so missions degrade gracefully; trigger phrasings are tested against ≥ 3 historical mission transcripts before ship |
| Extracting too aggressively makes the slim core unreadable | Medium | Maintainers can't follow normal-path behavior without jumping between skills | Hard rule documented in the slim core: extract only when procedure ≥ 50 lines AND fires on < 20% of missions |
| A skill's cache-creation cost exceeds steady-state savings on the missions where it does fire | Low | Net-negative for short or high-trigger-rate skills | Verify on a baseline mission re-run; if any single skill is net-negative, inline it |
| Loop semantics drift between core and extracted skills | Medium | Hannibal makes inconsistent decisions depending on which path executed | NFR 5 — each skill declares state contract in its description; reviewer verifies during extraction |
| BLOCKED-as-hard-interrupt change introduces false positives | Low | Hannibal interrupts itself unnecessarily on benign blocked messages | The skill defines BLOCKED narrowly (explicit `BLOCKED:` prefix from a pipeline agent) and runs a state check before intervening |

### Open Questions

- [ ] Should the legacy (non-native) playbook get the same slim-core / on-demand split in this PRD's scope, or should it stay monolithic since it's a fallback path that runs less often?
- [ ] One mega-skill ("Hannibal recovery") covering all rare procedures, vs. one skill per scenario? Tradeoff: one cache-creation cost vs. better trigger specificity. Suggested default: one per scenario, revisit if cache-creation cost dominates.
- [ ] Is there value in a tiny shared `playbooks/loop-state-glossary.md` (loaded once at run start, ~50 lines) that defines the state-variable vocabulary used by both the slim core and the extracted skills, so they can reference state without redefining it? Risk of premature shared abstraction.
- [ ] What's the right cadence to re-evaluate which skills remain net-positive? Suggestion: review cache-creation cost vs. mission savings each quarter using retro reports, prune or merge skills that aren't pulling their weight.
- [ ] Should the verification mission (cost A/B) be a fresh run of M-20260430-001's PRD, or a smaller representative one to keep the test loop fast?
