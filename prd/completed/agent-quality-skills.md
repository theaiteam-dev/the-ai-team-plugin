---
missionId: ~
---

# Agent Quality Skills & Mission Retrospectives

**Author:** Josh / Claude  **Date:** 2026-03-28  **Status:** Draft

## 1. Context & Background

A post-mission SDET audit of commit `24167cc` (a todo-app mission run by the A(i)-Team pipeline) found 20 issues across 4 severity levels. Three were critical bugs in user-interaction hot paths. The pipeline — Murdock (tests), B.A. (implementation), Lynch (review), Amy (investigation) — should have caught most of them but didn't.

The root cause is not missing capability but missing guidance. The agents have strong foundations (TDD enforcement, hook boundaries, anti-pattern bans) but gaps in three areas:

1. **No defensive coding guidance.** B.A. has clean code principles (SOLID, DRY, naming) but nothing about guarding lookups, async error recovery, or input validation consistency. He writes code that works on the happy path but breaks on edge cases.
2. **Mechanical reviewing.** Lynch checks boxes (tests pass? types clean? anti-patterns present?) but doesn't think adversarially about the implementation ("what input would break this function?").
3. **Test scope blind spots.** Murdock writes good unit tests but doesn't distinguish integration points from leaf modules. An App.tsx that wires 5 components together got the same mock-everything treatment as a utility function.

Meanwhile, quality reference material is fragmented:
- 5 reference files in `agents/references/` (594 lines, 100% TypeScript) are only used by Stockwell during final review — too late to prevent issues
- Test anti-patterns are duplicated across Murdock's prompt, Lynch's prompt, and the `test-writing` skill
- B.A.'s clean code principles are trapped in his prompt — Lynch and Stockwell can't reference the same standards when reviewing his work

This matters now because the pipeline is being used on real projects. Quality gaps that escape the pipeline require manual fix rounds, costing tokens and developer time. The existing `test-writing` skill proved the skills architecture works — it reduced test anti-patterns significantly. Extending that pattern to defensive coding, security, and code review will close the gaps the SDET audit exposed.

Beyond fixing the current gaps, there's no feedback loop. The SDET audit that surfaced these 20 issues was a manual, one-off effort. Every mission generates signal — Lynch rejections, Amy flags, Stockwell findings — but that signal evaporates when the mission ends. There's no structured way to capture what went wrong, identify patterns across missions, or feed learnings back into skills. Without a feedback loop, the same classes of bugs will recur in future missions.

## 2. Problem Statement

The A(i)-Team agent pipeline produces code with defensive coding gaps, inconsistent input validation, and over-mocked integration tests because agents lack shared, loadable quality guidance for implementation and review. Quality reference material exists but is fragmented across agent prompts and reference files that only one agent (Stockwell) reads — and only at the end of the pipeline when fixes are most expensive.

Additionally, there is no structured way to capture mission learnings. Each mission generates rejection reasons, investigation flags, and review findings — but this signal is lost after the mission ends. Without a retrospective mechanism, the same quality gaps recur across missions.

## 3. Target Users & Use Cases

**Primary users: A(i)-Team agents** — the agents that write, review, and investigate code during missions.

- **B.A.** needs defensive coding patterns so he produces code that handles edge cases, not just happy paths.
- **Lynch** needs adversarial review guidance and shared quality references so he catches implementation bugs, not just checklist items.
- **Murdock** needs integration test guidance so wiring-point items get appropriate test strategies, not blanket mocking.
- **Amy** needs logic edge case patterns so her Raptor Protocol catches defensive coding gaps, not just wiring issues.
- **Stockwell** needs the same quality references as Lynch, loaded as skills instead of read-on-demand files he may skip under context pressure.

**Secondary users: developers** running the A(i)-Team pipeline on their projects, who expect the pipeline to catch common bugs before they need manual review.

- **Developers** need a way to run a post-mission retrospective that synthesizes what went wrong, what patterns emerged, and what skill gaps exist — without manually reading every work log entry.
- **Future missions** benefit when retrospective findings are stored on the mission record and available for analysis across missions.

## 4. Goals & Success Metrics

| Goal | Metric | Target |
|------|--------|--------|
| Reduce defensive coding bugs | Critical/High issues in post-mission SDET audits | 8 (current) to 2 or fewer |
| Eliminate test quality gaps at integration points | Over-mocked integration tests flagged in audits | 2 (current) to 0 |
| Consolidate quality references | Number of places anti-patterns are defined | 3 (Murdock, Lynch, test-writing) to 1 (skill) |
| Reduce reference fragmentation | Reference files only used by 1 agent | 5 files (current) to 0 |
| Establish feedback loop | Missions with a stored retro report | 0% (current) to 100% (retro available for every completed mission) |

## 5. Scope

### In Scope

- Create new skills: `defensive-coding`, `security-input`, `code-patterns`
- Migrate content from `agents/references/` into the new skills (existing TypeScript examples preserved as-is)
- Wire agents to load relevant skills via frontmatter `skills:` key
- Wire existing `test-writing` skill to Lynch and Stockwell (currently Murdock-only)
- Update agent prompts: B.A. (defensive coding checklist), Lynch (adversarial review step), Murdock (integration test requirement, failure UX testing), Amy (logic edge case sweep, PRD non-functional checks)
- Minor prompt fixes: Face (type colocation guidance), Tawnia (changelog accuracy)
- Delete `agents/references/` directory after migration
- Update `agents/AGENTS.md` to reflect new skill wiring
- Add `retro_report` field to the missions table in the API database
- Add API endpoint to store and retrieve retrospective reports on mission records
- Add `ateam missions-retro` CLI command to write/read retro reports
- Create `/ai-team:retro` slash command and retro agent prompt
- Retro agent analyzes mission data (rejections, Amy flags, Stockwell findings, work logs) and produces a structured retrospective report stored on the mission record

### Out of Scope

- Rewriting existing TypeScript examples to pseudocode (future cleanup pass, not this mission)
- Changes to hook enforcement scripts (hooks already work correctly)
- Changes to orchestration playbooks or dispatch logic
- New anti-pattern detection in the `lint-test-quality.js` hook (could follow, but separate effort)
- Model allocation changes (e.g., promoting Lynch to opus)
- Automated skill evolution (agent auto-proposes PRs to skill files based on retro patterns — future iteration)
- Cross-mission trend analysis (comparing retro reports across multiple missions — future iteration)

## 6. Requirements

### Functional Requirements

#### New Skills

1. The system shall include a `skills/defensive-coding/SKILL.md` skill covering: guard-before-operate, async error recovery, input validation consistency, URL encoding, resource cleanup, transient state clearing, and functional state updates.
2. The system shall include a `skills/security-input/SKILL.md` skill containing the migrated content from `agents/references/security.md` plus new URL path encoding guidance.
3. The system shall include a `skills/code-patterns/SKILL.md` skill containing the migrated content from `agents/references/code-quality.md`, `agents/references/type-safety.md`, and `agents/references/api-and-data.md`.
4. New content in the `defensive-coding` skill shall use language-agnostic pseudocode examples, not framework-specific syntax.
5. Migrated content in `security-input` and `code-patterns` shall preserve existing TypeScript examples as-is.
6. Each skill file shall follow the existing skill format: YAML frontmatter with `name` and `description` fields, markdown body.

#### Skill Wiring

7. B.A. shall load skills: `defensive-coding`, `security-input`.
8. Lynch shall load skills: `test-writing`, `defensive-coding`, `security-input`, `code-patterns`.
9. Stockwell shall load skills: `test-writing`, `defensive-coding`, `security-input`, `code-patterns`.
10. Amy shall load skill: `defensive-coding`.
11. Murdock's existing skills (`test-writing`, `tdd-workflow`) shall remain unchanged.

#### Agent Prompt Updates

12. B.A.'s prompt shall include a "Defensive Coding" section referencing the loaded skill, and an expanded "Before Calling agentStop" checklist covering: lookup guards, async state safety, input validation parity, URL encoding, and teardown cleanup.
13. B.A.'s prompt shall include a PRD non-functional compliance check: verify implementation addresses styling, accessibility, and design requirements specified in the PRD.
14. Lynch's prompt shall include an "Adversarial Implementation Review" step between test quality evaluation and verdict, asking: "what input would break each function?", checking lookup guards, async error recovery, validation consistency, and URL encoding.
15. Lynch's prompt shall replace inline anti-pattern code examples with a reference to the `test-writing` skill plus a compact summary list of pattern names.
16. Murdock's prompt shall require at least one minimally-mocked integration test for work items whose `context` field references multiple files or integration points.
17. Murdock's prompt shall explicitly ban `toBeTruthy()` and `toBeDefined()` assertions on critical computed values.
18. Murdock's prompt shall require at least one test covering the failure UX path for any async user-facing operation.
19. Amy's prompt shall include a "Logic Edge Case Sweep" step in the Raptor Protocol covering: null/undefined guards, async error recovery, validation consistency, URL encoding, and resource cleanup.
20. Amy's prompt shall include PRD non-functional verification: check that styling, accessibility, and design requirements from the PRD are visually present.

#### Cleanup

21. All five files in `agents/references/` shall be deleted after their content is migrated.
22. Stockwell's prompt shall remove all `agents/references/` pointers and replace with skill references.
23. `agents/AGENTS.md` shall be updated to reflect the new skill wiring and removal of references.

#### Mission Retrospective System

26. The missions table in the API database shall include a `retro_report` field (markdown text, nullable) to store the retrospective report for a completed mission.
27. The API shall expose an endpoint to store a retrospective report on a mission record (`PATCH /api/missions/{id}` with `retroReport` field, or a dedicated `POST /api/missions/{id}/retro`).
28. The API shall expose an endpoint to retrieve the retrospective report for a mission (`GET /api/missions/{id}/retro`).
29. The `ateam` CLI shall include a `missions-retro` command group with:
    - `writeRetro --missionId <id> --report <markdown>` — stores the retro report on the mission record
    - `getRetro --missionId <id> --json` — retrieves the retro report for a mission
30. A `/ai-team:retro` slash command shall exist that invokes a retro agent after a mission completes.
31. The retro agent shall pull mission data from the API: all work item rejection reasons, Amy's investigation summaries (from `agentStop` work logs), Stockwell's final review verdict, and per-item work logs.
32. The retro agent shall analyze the mission data for patterns and produce a structured retrospective report covering:
    - **Rejection patterns**: Recurring classes of rejection (e.g., "3 items rejected for missing error handling") with specific rejection reasons grouped by category
    - **Investigation findings**: Amy's flags and what they reveal about systematic gaps
    - **Final review issues**: Stockwell's cross-cutting findings
    - **Skill gap recommendations**: Specific additions or changes to existing skills that would have prevented the issues found, referencing skill files by name
    - **Pipeline observations**: Where in the pipeline issues should have been caught but weren't (e.g., "Lynch approved items that had unguarded lookups — adversarial review gap")
    - **Token cost analysis**: Per-agent token usage and estimated cost, cost of rejection cycles (tokens spent on rejected items that had to re-run through the pipeline), and total mission cost. Data sourced from the existing `POST /api/missions/{id}/token-usage` endpoint.
33. The retro agent shall store the report on the mission record via `ateam missions-retro writeRetro`.
34. The retro report shall be visible in the kanban UI on the mission detail view.
35. The retro agent shall use opus model for pattern recognition across the full mission's work log data.

#### Minor Fixes

24. Face's prompt shall include guidance against creating separate type files for trivially small interfaces (2-5 fields) — colocate with implementation unless shared across modules.
25. Tawnia's prompt shall require reading implementation files (not just item descriptions) to verify changelog accuracy.

### Edge Cases

- If an agent's context window is under pressure from loaded skills, the agent should prioritize the skill content over verbose inline examples in its own prompt. This is why Lynch's inline anti-patterns are trimmed (requirement 15) — the skill provides the detail.
- If a work item has no `context` field or the context doesn't mention integration points, Murdock's integration test requirement (16) does not apply — standard unit testing is sufficient.
- The `defensive-coding` skill's pseudocode examples must be interpretable regardless of the target project's language. Avoid syntax that only makes sense in one language.
- If `/ai-team:retro` is run before a mission completes (not all items in `done`, or Tawnia hasn't committed), the retro agent shall warn the user and produce a partial report noting it's based on incomplete data.
- If a mission has zero rejections, zero Amy flags, and a clean Stockwell verdict, the retro report should still be generated — documenting "clean mission" is valuable signal that the pipeline is working.
- If the mission has no work log data (e.g., a mission that was abandoned), the retro agent shall report that insufficient data exists and skip analysis.

## 10. Risks & Open Questions

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Skill content increases context window pressure for agents with 4 skills (Lynch, Stockwell) | Medium | Agent may truncate or deprioritize skill content | Trim inline duplication from agent prompts to offset; monitor token usage in next mission |
| Agents read skill content but don't apply it consistently | Medium | Quality gaps persist despite better guidance | Adversarial review step (requirement 14) forces Lynch to actively check defensive patterns, not just have them in context |
| Pseudocode examples in defensive-coding are less actionable than language-specific examples | Low | B.A. may not apply patterns correctly to target project | Keep examples concrete and structural; use clear bad/good pairs with explanatory comments |
| Migration from references/ to skills/ introduces content loss | Low | Quality patterns dropped during consolidation | Diff reference files against skill files before deleting references |
| Retro report quality depends on work log richness | Medium | Thin work logs produce shallow retros | agentStop summaries already capture meaningful detail; Amy and Stockwell produce structured findings |
| Retro becomes a checkbox exercise instead of actionable | Low | Reports generated but never acted on | Skill gap recommendations section gives concrete next steps; retro stored on mission record makes it reviewable |

### Open Questions

- None.
