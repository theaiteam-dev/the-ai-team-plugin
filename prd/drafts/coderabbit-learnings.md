---
missionId: ~
---

# CodeRabbit Review Learnings

**Author:** Josh / Claude  **Date:** 2026-03-30  **Status:** Draft

## 1. Context & Background

Analysis of CodeRabbit review comments across 9 merged PRs (#1, #2, #3, #4, #5, #11, #12, #13, #14, #15, #16, #18, #19, #21) revealed 12 recurring pattern categories. These are not one-off bugs — they are systematic gaps where the AI agents (and human-assisted code) make the same class of mistake across multiple PRs, files, and time periods.

The existing agent skills (`code-patterns`, `defensive-coding`, `security-input`, `test-writing`) cover some of these topics generically but lack the specificity needed to prevent recurrence. For example, `defensive-coding` says "guard before operate" but doesn't show how to validate JSON-parsed array elements as `string[]` — the exact thing CodeRabbit flagged 15+ times.

This PRD proposes targeted updates to agent skills, reference docs, Go CLI conventions, and CodeRabbit configuration to close these gaps.

## 2. Problem Statement

AI agents keep producing code with the same categories of defects across PRs because the instruction surface (skills, references, CLAUDE.md) either doesn't cover the specific pattern or covers it too generically for agents to apply. CodeRabbit catches these in review, some get fixed, some get punted, and the same patterns reappear in the next PR.

## 3. Findings by Category

### 3.1 API Input Validation Depth (15+ hits, 6 PRs)

**What CodeRabbit flags:** API route handlers trust `request.json()` without runtime type checks. `Array.isArray()` is used but doesn't check element types — accepts `[1, {}]` as valid `string[]`. Fields not trimmed before persist. Bounds declared in OpenAPI not enforced in code.

**Affected files (examples):**
- `packages/kanban-viewer/src/app/api/items/route.ts` — acceptance array elements
- `packages/kanban-viewer/src/app/api/missions/*/route.ts` — mission fields
- `packages/kanban-viewer/src/lib/item-transform.ts` — parseAcceptance
- `packages/kanban-viewer/src/app/api/hooks/events/route.ts` — token/model fields

**Fix:** Update `defensive-coding/SKILL.md` with concrete patterns:
- Validate array element types, not just `Array.isArray()`
- Trim string inputs before persist
- Enforce OpenAPI-declared bounds (maxItems, maxLength) in route handlers
- Include TypeScript examples showing the exact `arr.every(el => typeof el === 'string')` pattern

### 3.2 OpenAPI Schema Drift (3 hits, 2 PRs)

**What CodeRabbit flags:** OpenAPI spec diverges from actual API behavior — missing `nullable: true`, unbounded arrays, request/response shape mismatches.

**Fix:** Add to `defensive-coding/SKILL.md`:
- "When adding or modifying API fields, update the OpenAPI spec to match"
- "Runtime validation must enforce what the schema declares"

### 3.3 Atomicity / Race Conditions (5 hits, 3 PRs)

**What CodeRabbit flags:** Multi-step database operations (claim + log + WIP check + stage update) done as separate queries instead of transactions. TOCTOU races, partial-write risks.

**Fix:** Add to `code-patterns/SKILL.md` database section:
- "Multi-step DB operations that must be consistent MUST use `prisma.$transaction()`"
- Bad/good example showing read-then-write without vs with transaction

### 3.4 Go CLI Output Streams (4 hits, 2 PRs)

**What CodeRabbit flags:** Go CLI commands use `fmt.Println` (global stdout) instead of `cmd.OutOrStdout()` in fallback paths, breaking test output capture.

**Fix:** Create new `skills/go-cli/SKILL.md` covering:
- Always use `cmd.OutOrStdout()` and `cmd.ErrOrStderr()`, never bare `fmt.Println`
- Every parameterized REST endpoint must interpolate all path parameters
- Test that URLs are correctly formed

### 3.5 Go CLI Path Parameter Wiring (4 hits, 1 PR)

**What CodeRabbit flags:** CLI commands calling `/items/{id}` or `/missions/{missionId}` fail to interpolate the ID into the URL.

**Fix:** Include in `skills/go-cli/SKILL.md` with bad/good examples.

### 3.6 Incomplete Renames (4 hits, 2 PRs)

**What CodeRabbit flags:** Agent renamed in one place but references survive in hooks, playbooks, dispatch descriptions, KNOWN_AGENTS arrays.

**Fix:** Add to CLAUDE.md agent boundaries section:
- "When renaming an agent, grep the entire codebase for the old name: agents/, scripts/hooks/, playbooks/, commands/, CLAUDE.md, tests"

### 3.7 Hook Enforcement Gaps (3 hits, 1 PR)

**What CodeRabbit flags:** New/renamed agents not added to enforcement hooks (block-write, block-browser). Agent operates without guardrails.

**Fix:** Covered by the rename rule above — include hooks in the grep checklist.

### 3.8 Invalid Code Examples in Skills/Docs (3 hits, 1 PR)

**What CodeRabbit flags:** `await` inside non-`async` functions, incorrect API usage in examples. Agents learn broken patterns from their own reference docs.

**Fix:** Add to CLAUDE.md or a review checklist:
- "Code examples in skills and agent docs must be syntactically valid"
- Consider a CI check that extracts and type-checks code blocks from skill files

### 3.9 Test Assertion Quality (4 hits, 3 PRs)

**What CodeRabbit flags:** Error-path tests call `.Error()` without first asserting error is non-nil (panics). Test fixtures have mismatched IDs/agent names. "No violation" tests only check stderr, not exit code.

**Fix:** Update `test-writing/references/testing-anti-patterns.md`:
- "Error-path tests MUST assert error is non-nil before accessing .Error()"
- "Test fixtures must be internally consistent — matching IDs, agent names, timestamps"
- "Negative tests (no violation) should also assert success exit code"

### 3.10 Async Before Exit (2 hits, 1 PR)

**What CodeRabbit flags:** `sendObserverEvent()` fired, then `process.exit(0)` kills in-flight HTTP requests.

**Fix:** Add to `code-patterns/SKILL.md` async section:
- "Never `process.exit()` with in-flight promises — use `Promise.allSettled()` first"

### 3.11 Markdown Code Fence Languages (10+ hits, 5 PRs)

**What CodeRabbit flags:** Fenced code blocks without language identifiers (MD040).

**Fix:** This is a linting/tooling concern, not an agent skill. Options:
- Add markdownlint config or pre-commit hook
- Or accept this as low-priority noise

### 3.12 Document Numbering Consistency (6 hits, 4 PRs)

**What CodeRabbit flags:** Section numbers duplicated or out of sequence when new sections inserted. Cross-references not updated.

**Fix:** Low-priority. Could add to a doc-writing reference but this is tedious and error-prone even for humans.

## 4. Proposed Changes

### P0 — High impact, recurring across many PRs

| Change | Target File | Addresses |
|--------|-------------|-----------|
| Add API validation depth patterns with TypeScript examples | `skills/defensive-coding/SKILL.md` | 3.1, 3.2 |
| Add transaction/atomicity patterns | `skills/code-patterns/SKILL.md` | 3.3 |
| Add async-before-exit pattern | `skills/code-patterns/SKILL.md` | 3.10 |
| Add error-path assertion rules | `skills/test-writing/references/testing-anti-patterns.md` | 3.9 |

### P1 — Moderate impact, concentrated in specific areas

| Change | Target File | Addresses |
|--------|-------------|-----------|
| Create Go CLI conventions skill | `skills/go-cli/SKILL.md` (new) | 3.4, 3.5 |
| Add rename-grep checklist | `CLAUDE.md` | 3.6, 3.7 |
| Add code example validity rule | `CLAUDE.md` | 3.8 |

### P2 — Nice to have, mostly tooling

| Change | Target File | Addresses |
|--------|-------------|-----------|
| Create `.coderabbit.yaml` with review instructions | `.coderabbit.yaml` (new) | 3.11, 3.12, false positive reduction |
| Add markdownlint pre-commit hook | `scripts/hooks/` or `.pre-commit-config.yaml` | 3.11 |

## 5. CodeRabbit Configuration

Create `.coderabbit.yaml` to encode learnings and reduce false positives:

- Files under `commands/` and `playbooks/` are AI agent playbooks, not executable scripts. Shell concerns (pipefail, exit codes) don't apply to bash blocks in these files.
- The `nullable` asymmetry between POST and PATCH request schemas in `openapi.yaml` is intentional (POST enforces presence, PATCH allows clearing).
- Agent model selection is in YAML frontmatter (`model:` key) — don't flag dispatch-time model parameters.
- Numeric test count minimums in CLAUDE.md are guidelines, not gates.

## 6. Success Criteria

- CodeRabbit review comments on the next 3 PRs show < 50% recurrence of patterns in categories 3.1-3.5
- No new "incomplete rename" findings after the grep checklist is added
- Go CLI PRs have zero output-stream or path-parameter findings

## 7. Non-Goals

- Fine-tuning models on this data (separate initiative, see `~/Code/TheAITeam/MODEL-IDEA.md`)
- Rewriting existing code to fix all past instances (fix forward as files are touched)
- Achieving zero CodeRabbit comments (some findings are useful one-off catches)
