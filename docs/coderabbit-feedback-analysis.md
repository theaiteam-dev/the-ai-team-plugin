# CodeRabbit Feedback Analysis — PR #30

Analysis of review comments from CodeRabbit on the pipeline parallelism PR (4 review rounds, 46 root comments). Grouped by pattern to identify systemic improvements for agent prompts and skills.

## Pattern 1: Input Validation on API Endpoints (5 comments)

**Comments:** #5 (route.ts:90), #6 (route.ts:105), #7 (compute/route.ts:47), #23 (missionPrecheck.go:71), #29 (adaptive-scaling-types.ts:11)

**Issue:** API handlers accept `request.json()` without guarding against `null`, non-object payloads, or missing required fields. A `null` body crashes on property access; non-object payloads bypass validation silently.

**Examples:**
- PATCH `/api/missions/:id` reads `body.scalingRationale` without checking body is an object
- POST `/api/scaling/compute` reads `body.concurrencyOverride` from potentially null parsed JSON
- CLI `--output` flag accepts any JSON value when only objects are valid

**Generalized rule for agents:**

> Every API endpoint or CLI command that parses external input (JSON body, query params, CLI flags) must guard against null/non-object values before accessing properties. Return 400 (or CLI error) immediately — never let invalid input reach business logic.

**Where to apply:**
- **B.A.**: Already has "guard before operate" in defensive-coding skill, but the API-specific pattern of `request.json()` returning null isn't called out. Add a concrete example to defensive-coding showing the `null`/non-object check pattern after JSON parsing.
- **Face**: The "input validation" AC rule we just added covers user-facing input but doesn't explicitly cover API body validation. Consider adding: "For API endpoints that accept JSON bodies, include an AC for malformed/null body handling."

---

## Pattern 2: Inconsistent Error Handling Patterns (2 comments)

**Comments:** #5 (route.ts:90 — hand-rolled errors), #6 (route.ts:105 — missing validation)

**Issue:** New API routes hand-roll error responses instead of using existing error factory functions (`src/lib/errors.ts`). This causes contract drift — different routes return different error shapes.

**Generalized rule for agents:**

> When adding API error responses, always use the project's existing error factory functions. Never hand-construct `{ success: false, error: { code, message } }` objects directly — import and call the factory.

**Where to apply:**
- **B.A.**: The "read existing code patterns" step says "use existing utilities when available" but doesn't specifically call out error handling. The defensive-coding skill's "Consistent Error Shape" pattern (section 8) covers this conceptually, but B.A. should be reminded to search for error factories before writing error responses.
- **Lynch**: Should flag hand-rolled error responses during review — this is an easy pattern to spot.

---

## Pattern 3: Path Traversal / Unsafe String Interpolation (2 comments)

**Comments:** #2 (agentStop.go:74 — mission ID in path), #21 (tawnia.md:275 — mission ID in rm -rf)

**Issue:** Environment variable values (`ATEAM_MISSION_ID`) used directly in filesystem paths without sanitization. A crafted value like `../../etc` escapes the intended directory. Particularly dangerous with `rm -rf`.

**Generalized rule for agents:**

> Any value from an environment variable, CLI flag, or API parameter used in a filesystem path must be sanitized — at minimum, use `filepath.Base()` (Go) or equivalent to strip directory traversal. For destructive operations (`rm -rf`), validate the target path starts with the expected prefix before executing.

**Where to apply:**
- **B.A.**: The defensive-coding skill has "URL Encoding" (section 4) for URL paths but nothing equivalent for filesystem paths. Add a filesystem path sanitization pattern.
- **Face**: When work items involve filesystem operations or temp directory management, include an AC for path validation.

---

## Pattern 4: Stale Documentation / Inconsistent Docs (5 comments)

**Comments:** #1 (docs path reference), #10 (orchestration double agentStart), #22 (learnings doc ambiguity), #27 (teams-messaging FLAG path), #28 (teams-messaging manual pool release), plus round 4: board-move reference in teams-messaging:12, Amy FLAG `--return-to implementing` (invalid per transition matrix), data mismatches in prod-timings-gap-analysis (4.2 vs 4.7, 0.8 vs 0.9)

**Issue:** Documentation and playbooks reference superseded behavior — manual pool release instructions that conflict with atomic `agentStop`, double `agentStart` calls, FLAG handling that predates peer handoff. This was the most frequently hit pattern across all 4 review rounds (8 comments total).

**Generalized rule for agents:**

> When changing a behavioral contract (how agents start, stop, or hand off), search for all documentation that references the old behavior and update it in the same PR. Stale docs cause agents to follow contradictory instructions.

**Where to apply:**
- **Tawnia**: Already responsible for documentation, but currently only runs at mission end. The stale-doc problem happens when implementation changes land without corresponding doc updates in the same commit. Tawnia's checklist should include: "Search for references to changed behaviors in `docs/`, `playbooks/`, `skills/`, and `agents/` — update any that describe superseded flows."
- **Lynch/Stockwell**: Should flag doc/code inconsistencies during review. If a code change modifies agent lifecycle behavior, check that `skills/` and `playbooks/` still match.

---

## Pattern 5: CLI Output Pattern Inconsistency (1 comment)

**Comments:** #3 (scaling_compute.go:67 — fmt.Print vs cmd.OutOrStdout)

**Issue:** Some CLI commands write to global stdout (`fmt.Printf`) instead of the Cobra command writer (`cmd.OutOrStdout()`). This breaks test capture and output redirection.

**Generalized rule for agents:**

> In Cobra CLI commands, always write to `cmd.OutOrStdout()` — never to global `fmt.Print*`. This ensures output is captured in tests and respects redirection.

**Where to apply:**
- **B.A.**: When implementing CLI commands, should grep existing commands for the output pattern and follow it. The "read existing code patterns" step covers this implicitly, but the specific `OutOrStdout()` pattern could be called out in a CLI-specific section of defensive-coding if CLI work is frequent.

---

## Pattern 6: Import Convention Violations (1 comment)

**Comments:** #4 (test file using relative imports instead of `@/` alias)

**Issue:** Test files using relative imports (`../components/foo`) instead of the project's configured `@/` alias (`@/components/foo`).

**Generalized rule for agents:**

> Match the project's import convention. If the project configures path aliases, use them consistently — even in test files.

**Where to apply:**
- **Murdock/B.A.**: The "read existing code patterns" step should include checking import conventions. This is already covered by "import, don't redefine" in defensive-coding but that focuses on type reuse, not path aliases. Add a note: "Match the project's import style — if `@/` aliases exist, use them."

---

## Pattern 7: Type Safety in Tests (2 comments)

**Comments:** #24 (stop-rejected.test.ts:162 — invalid stage type), #25 (scaling-rationale-modal.test.tsx:13 — wipLimit field mismatch)

**Issue:** Test files use intentionally invalid data without proper type assertions (`as unknown as StageId`), or test fixtures don't match the current type definition (missing fields added after the test was written).

**Generalized rule for agents:**

> When writing tests with intentionally invalid data, use explicit type assertions (`as unknown as Type`) so TypeScript doesn't flag it as a compile error. When type definitions change, update test fixtures to match.

**Where to apply:**
- **Murdock**: The test-writing skill should mention the `as unknown as Type` pattern for negative/invalid input tests. This is a common need and currently not documented.
- **B.A.**: When changing type definitions, should grep for test fixtures that construct instances of the changed type and update them.

---

## Pattern 8: False Positive — Skill Allowlist (7 comments)

**Comments:** #13-19 (all agent `skills:` frontmatter entries)

**Issue:** CodeRabbit flags `pool-handoff`, `teams-messaging`, `ateam-cli`, and `agent-lifecycle` as "outside the allowed skill set" because its configuration references an outdated allowlist.

**Action:** These are false positives. The skills exist and are intentionally used. Update CodeRabbit's configuration or `.coderabbit.yaml` to include the current skill list.

---

## Pattern 9: Dual Code Paths Must Stay In Sync (2 comments, round 4)

**Comments:** Round 4 — agentStop.go:175 (--body payload not used for pool), agentStop.go:201 (pool runs on wipExceeded)

**Issue:** The `agentStop` CLI has two input paths: individual flags and raw `--body` JSON. Local pool management read `agent`, `outcome`, and `advance` from flags even when `--body` was the actual payload sent to the API. This caused pool state to diverge from API state — the CLI would release/claim the wrong slot locally while the API processed a different combination.

Additionally, pool mutations (self-release + next-agent claim) ran unconditionally even when the API response contained `wipExceeded=true`, meaning the local filesystem pool diverged from the API's view of what was claimed.

**Generalized rule for agents:**

> When a command has multiple input paths (flags vs raw body, config file vs CLI args), local side effects must use the **resolved** values — the same ones sent to the API — not the raw flag values. Additionally, check API response status before performing local side effects that assume the API operation succeeded.

**Where to apply:**
- **B.A.**: Add to defensive-coding skill: "When a CLI command has both flag-based and raw-body input paths, ensure local side effects use the same resolved values as the API call. Check response status before performing local state mutations."
- **Lynch**: Should flag any CLI command where local side effects (filesystem, cache, pool) run before or regardless of API response validation.

---

## Summary: Recommended Changes by Agent

| Agent | Change | Priority |
|-------|--------|----------|
| **B.A.** | Add filesystem path sanitization to defensive-coding skill | High |
| **B.A.** | Add JSON body null-guard pattern to defensive-coding skill (API-specific) | High |
| **B.A.** | Add "dual code paths must sync" pattern to defensive-coding (flag vs --body) | High |
| **B.A.** | Note in defensive-coding: grep for error factories before writing error responses | Medium |
| **B.A.** | Add "check API response before local side effects" to defensive-coding | Medium |
| **Murdock** | Add `as unknown as Type` pattern to test-writing skill for invalid input tests | Medium |
| **Murdock/B.A.** | Match project import aliases in test and impl files | Low |
| **Face** | Add AC rule for API body validation on endpoints that accept JSON | Medium |
| **Face** | Add AC rule for path sanitization when items involve filesystem ops | Low |
| **Tawnia** | Add checklist item: search for stale doc references to changed behaviors | High |
| **Lynch** | Flag hand-rolled error responses, doc/code inconsistencies, and local-side-effect-before-API-check | Medium |
| **Config** | Update CodeRabbit skill allowlist to stop false positives | Low |
