---
missionId: ~
---

# Agent Blind Spot Fixes

**Author:** Josh / Claude  **Date:** 2026-03-30  **Status:** Draft

## 1. Context & Background

A head-to-head comparison of test harness pass-3 and pass-4 (a todo-app mission run twice with agent prompt tweaks between passes) revealed that while pass-4 produced measurably better architecture, API design, and test coverage, four systematic behavioral gaps persisted or worsened across both passes. These gaps are distinct from the defensive coding and skill wiring issues addressed in the Agent Quality Skills PRD (shipped on `feat/structured-work-item-fields`) — they concern how agents *apply* what they know rather than what knowledge they have access to.

The pass-3 to pass-4 comparison showed:
- **6 identical blind spots** carried forward unchanged between passes (AbortController, keyboard accessibility, onBlur commit, edit input aria-label, act() warnings, mutation concurrency guards)
- **2 regressions** introduced by pass-4 (Cancel button removed from delete confirmation, reusable Feedback.tsx components inlined without justification)
- **1 inconsistency** where a pattern (submitting guard) was applied in one component but not analogous ones

These gaps survive because the TDD pipeline amplifies Murdock's initial test scope decisions. If Murdock doesn't write a test for keyboard accessibility, B.A. never implements it, Lynch never reviews it, and Amy never probes it. The pipeline has no mechanism for an agent to notice "this class of issue exists elsewhere too" or "I'm removing functionality the work item didn't ask me to remove."

This matters now because the Agent Quality Skills work gave agents better *knowledge* (defensive coding skill, adversarial review step, test category awareness). The next step is fixing how agents *behave* — generalizing fixes, preserving existing affordances, and checking for consistency across analogous code.

## 2. Problem Statement

A(i)-Team agents apply fixes and patterns locally without propagating them to analogous locations, remove existing UI affordances during refactoring without being asked to, and systematically miss accessibility and resource cleanup categories because no agent in the pipeline is prompted to check for cross-cutting consistency. The TDD pipeline amplifies these gaps: Murdock's test scope decisions cascade through every downstream agent, and no agent asks "does this same problem exist in sibling code?"

## 3. Target Users & Use Cases

**Primary users: A(i)-Team agents** — the agents that write, test, review, and investigate code during missions.

- **Murdock** needs a test category checklist that forces explicit coverage decisions for accessibility, cleanup, and concurrency — not just happy path and error path.
- **B.A.** needs a guard against removing existing UI affordances (buttons, reusable components, user-facing features) unless the work item explicitly calls for removal.
- **Lynch** needs a consistency check step: when a pattern is applied in one place, flag if it's missing in analogous places within the same mission scope.
- **Amy** needs a generalization probe: when a bug or gap is found in one location, systematically check whether the same class of issue exists in related code.

**Secondary users: developers** running the pipeline, who expect consistent pattern application and no surprise regressions from agent refactoring.

## 4. Goals & Success Metrics

| Goal | Metric | Target |
|------|--------|--------|
| Eliminate pattern inconsistency | Instances where a pattern is applied in one component but missing in analogous ones (per SDET audit) | 1+ (current) to 0 |
| Stop unasked-for affordance removal | UI features removed without work item justification (per SDET audit) | 2 (current) to 0 |
| Close accessibility blind spot | Accessibility issues (keyboard nav, aria-labels, focus management) surviving to SDET audit | 4+ (current) to 1 or fewer |
| Close cleanup blind spot | Resource cleanup issues (AbortController, event listeners, timers) surviving to SDET audit | 1+ (current) to 0 |
| Improve cross-location bug detection | Amy flags that identify the same class of bug in multiple locations vs. only the first instance found | 0% (current) to 50%+ |

## 5. Scope

### In Scope

- Murdock prompt update: add explicit test category checklist (happy path, error path, accessibility/keyboard, cleanup/unmount, concurrency) that Murdock must address per work item — categories can be marked N/A with justification but cannot be silently skipped
- B.A. prompt update: add "preservation guard" — do not remove existing UI affordances (buttons, components, user-facing features, accessibility attributes) unless the work item explicitly requires their removal; when refactoring, preserve the functional surface area
- Lynch prompt update: add "consistency check" step — after reviewing the current item, check whether patterns applied in this item (guards, validation, error handling, accessibility) are missing in analogous locations within the mission's scope
- Amy prompt update: add "generalization probe" to Raptor Protocol — when a bug or gap is found, check whether the same class of issue exists in sibling/related code before reporting; report all instances, not just the first

### Out of Scope

- Changes to skill files (defensive-coding, security-input, code-patterns) — those were shipped in Agent Quality Skills
- Changes to hook enforcement scripts
- Changes to orchestration playbooks or dispatch logic
- Murdock writing tests for categories outside the work item's scope (the checklist forces *consideration*, not mandatory tests for every category)
- Automated cross-mission trend analysis (future iteration, depends on retro system)
- Model allocation changes

## 6. Requirements

### Functional Requirements

#### Murdock: Test Category Checklist

1. Murdock's prompt shall include a test category checklist that must be explicitly addressed for each work item: happy path, error/failure path, accessibility/keyboard interaction, cleanup/unmount/teardown, and concurrency/in-flight guards.
2. Each category shall be either covered by at least one test OR marked as not applicable with a brief justification in Murdock's agentStop summary.
3. The checklist shall not mandate tests for every category — it shall mandate that Murdock *considers* every category and makes an explicit decision.

#### B.A.: Preservation Guard

4. B.A.'s prompt shall include a preservation guard: when refactoring or restructuring code, B.A. shall not remove existing UI affordances (buttons, confirmation dialogs, reusable components, accessibility attributes, user-facing features) unless the work item's acceptance criteria explicitly call for their removal.
5. When B.A. inlines or consolidates components, the functional surface area (user-visible controls, interaction patterns, error displays) shall be preserved in the refactored code.
6. If B.A. identifies an existing affordance that appears broken or unused, B.A. shall note it in the agentStop summary rather than silently removing it.

#### Lynch: Consistency Check

7. Lynch's prompt shall include a "Consistency Check" step after the adversarial implementation review: for each pattern applied in the current work item (input validation, error handling, loading guards, accessibility attributes, concurrency guards), Lynch shall check whether analogous locations in the mission scope are missing the same pattern.
8. If Lynch finds a pattern inconsistency, it shall be reported as a review finding with the specific locations identified, but shall not block approval of the current item unless the inconsistency is within the current item's own files.
9. Lynch's consistency findings shall be included in the agentStop summary so they are available to the retro system.

#### Amy: Generalization Probe

10. Amy's Raptor Protocol shall include a "Generalization Probe" step: when Amy identifies a bug, gap, or missing pattern in one location, Amy shall check whether the same class of issue exists in sibling or related code within the mission scope.
11. Amy shall report all instances of a generalized issue, not just the first instance found, with specific file and function references for each.
12. The generalization probe shall cover at minimum: missing guards, missing error handling, missing accessibility attributes, missing cleanup, and missing concurrency controls.

### Edge Cases

- If a work item is a pure refactoring task (type: "task"), the preservation guard still applies — refactoring should not remove user-facing functionality.
- If Lynch's consistency check finds issues in files outside the current work item's `outputs`, those findings are informational only — they should not cause rejection of the current item.
- If Amy's generalization probe finds issues in code outside the mission scope (pre-existing code not touched by any work item), those findings should be reported as "pre-existing" and not counted against pipeline agents.
- If Murdock marks all non-happy-path categories as N/A, Lynch should flag this during review as a potential test scope gap.

## 10. Risks & Open Questions

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Test category checklist becomes rote — Murdock marks categories N/A without genuine consideration | Medium | Blind spots persist despite checklist | Lynch reviews Murdock's N/A justifications during the review stage; weak justifications are flagged |
| Preservation guard makes B.A. overly conservative — preserves dead code or broken affordances | Low | Code bloat, confusing UX | Guard allows noting broken affordances in summary rather than preserving them silently; Lynch can flag |
| Consistency check expands Lynch's scope too much, increasing review time and token cost | Medium | Slower pipeline, higher cost | Scope consistency check to mission items only, not entire codebase; informational findings don't block |
| Generalization probe turns Amy into a full codebase auditor | Low | Amy exceeds time/token budget | Scope probe to sibling/related code, not full codebase; limit to same class of issue found |

### Open Questions

- [ ] Should Lynch's consistency findings automatically create new work items for the inconsistent locations, or just be reported in the retro?
- [ ] Should the test category checklist be configurable per-project (e.g., a project with no UI might permanently disable the accessibility category)?

## Future Consideration: Server-Side Retro Generation

The current `/ai-team:retro` system dispatches an opus agent to gather mission data from the API, analyze patterns, and produce a structured markdown report. In practice, nearly all of this work is deterministic data aggregation:

- Rejection patterns: group work logs by rejection reason — SQL query + count
- Amy findings: extract agentStop summaries where agent = Amy — data lookup
- Stockwell verdict: pull one work log entry — lookup
- Pipeline timing: compute stage durations from activity feed timestamps — arithmetic
- Token cost: already computed server-side by `POST /api/missions/{id}/token-usage`
- Skill gap recommendations: map rejection categories to canned recommendations — rule-based

The only LLM-contributed value is free-form prose in "pattern" and "recommendation" fields, which could be templated or left for human input.

**Proposed change:** Replace the retro agent with a server-side `POST /api/missions/{id}/retro` endpoint that runs the queries, applies grouping logic, and renders the markdown report. The `/ai-team:retro` command would call this endpoint and display the result instead of dispatching an agent. This would be faster, cheaper (zero tokens), and more consistent.

**SaaS consideration:** Server-side retro generation is a natural fit for a paid tier of a hosted kanban-viewer. It requires no client-side agent dispatch, runs entirely within the API, and produces analytics that improve with data volume (cross-mission trend analysis, per-team skill gap tracking). A free tier could show the raw mission data; a paid tier generates the structured retro with trend analysis across missions. This should be evaluated as part of any future SaaS packaging of kanban-viewer rather than built as a standalone plugin feature.

## Appendix: Evidence from Pass-3 vs Pass-4 Comparison

### Improvements (agent tweaks working)
- `updateTodo` split into `toggleTodo` + `updateTodoTitle` — narrower API surface
- `encodeURIComponent` added to all parameterized routes
- `TodoList` extracted as dedicated component — better separation of concerns
- `TodoItem` and `CreateTodoForm` became self-contained (direct API calls vs callback props)
- Semantic HTML (`<li>` instead of `<div>`)
- Submitting guard on `CreateTodoForm` (prevents double-submit)
- Input preserved on API failure (pass-3 cleared it)
- Optimistic state with rollback on `TodoItem`
- Accessibility improvements (`aria-label` on delete, `<label>` on input)
- Test infrastructure improvements (`setup.ts` extraction, `userEvent` over `fireEvent`, failure-path tests)

### Regressions (agents over-simplifying)
- `Feedback.tsx` deleted — `EmptyState` and `ErrorBanner` were reusable components in pass-3, inlined in pass-4
- Cancel button removed from delete confirmation — pass-3 had Confirm + Cancel, pass-4 only has Confirm
- `onError` prop removed from `TodoItem` — breaking API change without justification

### Held Ground (persistent blind spots across both passes)
- No `AbortController` on `fetchTodos`
- `act()` warnings in tests
- No keyboard trigger for edit mode (onDoubleClick only)
- No `onBlur` commit on edit input
- No `aria-label` on edit input
- No in-flight guard on `TodoItem` mutations (only `CreateTodoForm` guarded)
