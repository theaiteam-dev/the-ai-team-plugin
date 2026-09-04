---
name: code-review
description: Reviews all unmerged code in the current branch for readability, security, correctness, types, and test quality. Produces findings by severity (Must Fix / Should Fix / Consider) with a parallelism estimate. Invoked standalone or as the review phase of /ai-team:review.
---

# Code Review

Review all unmerged code in the current branch.

## Step 1: Determine What to Review

First, detect the base branch: `git rev-parse --verify main 2>/dev/null || git rev-parse --verify master`.

Then determine the review scope:

- **On a feature branch with uncommitted changes**: review only the uncommitted work using `git diff HEAD`
- **On a feature branch with a clean working tree**: review all commits diverged from the base branch using `git diff <base-branch>...HEAD`
- **On the base branch with uncommitted changes**: review staged and unstaged changes using `git diff HEAD`
- **On the base branch with no uncommitted changes**: nothing to review — inform the user

## Step 2: Launch the Review

Dispatch a subagent via the Task tool to perform a thorough review — use `code-review-expert` if it appears in your available agent types, otherwise `general-purpose` with this skill's checklist embedded in the prompt. The subagent should:

1. Run the appropriate diff command from Step 1, plus `git log --oneline <base-branch>...HEAD` if on a feature branch, to collect all changes under review
2. Read any files it needs for additional context
3. Evaluate the changes against the criteria in the review checklist below
4. Consult this skill's `references/` directory for language-specific and domain-specific examples of good and bad patterns

## Review Checklist

The subagent should verify each of these for every changed file:

- **Correctness**: Does it handle edge cases (empty arrays, null, zero, negative numbers)?
- **Error paths**: What happens when things fail? Are errors logged with context?
- **Security**: Is user input validated? Are queries parameterized? Secrets externalized?
- **Performance**: Any N+1 queries? Unbounded loops? Missing pagination? Unnecessary re-renders?
- **Types**: Any `any` usage? Are return types explicit on public interfaces?
- **Tests**: Do tests exist for the new behavior? Are they testing behavior, not implementation?
- **Naming**: Can you understand the code without reading the PR description?
- **Scope**: Does the PR do one thing? Should it be split?
- **Dependencies**: Are new dependencies justified? Are they maintained and not bloated?
- **Backwards compatibility**: Will this break existing clients/consumers?

## Step 3: Summarize

Present the subagent's findings to the user organized by severity:

1. **Must Fix** - Issues that should be resolved before merging (security, correctness bugs, broken tests)
2. **Should Fix** - Issues that meaningfully improve quality (readability, weak types, missing edge cases)
3. **Consider** - Optional improvements (style nits, minor refactors)

### Parallelism Estimate

After presenting findings by severity, analyze file independence across all review findings and report a **Parallelism Estimate** showing how many subagents could fix issues in parallel.

**Rules for grouping:**
- Fixes that touch the same file or closely related code (e.g., a function and its caller in the same file) must be serialized in one agent
- Fixes that touch independent files can run in parallel as separate agents
- Number each finding sequentially across all severity levels

**Report two groupings:**

1. **Must Fix + Should Fix** — how many parallel subagents are needed if only addressing blocking and quality issues
2. **All items** — how many parallel subagents if addressing everything including Consider items

**Example output:**

```
## Parallelism Estimate

**Must Fix + Should Fix (4 items) → 3 parallel subagents**
- Agent 1: #1, #3 (both touch src/parser.ts)
- Agent 2: #2 (src/api.ts)
- Agent 3: #4 (src/validator.ts)

**All items (6 items) → 4 parallel subagents**
- Agent 1: #1, #3 (both touch src/parser.ts)
- Agent 2: #2 (src/api.ts)
- Agent 3: #4, #6 (both touch src/validator.ts)
- Agent 4: #5 (src/utils.ts)
```

## Output Formatting Rules

For each issue:
- Reference the specific file and line
- Explain *why* it's a problem, not just *that* it's a problem
- Suggest a concrete fix or alternative
- Label severity clearly so the author knows what's blocking vs. optional

When something is done well, call it out briefly — positive reinforcement of good patterns helps the team.

Do not nitpick style preferences that aren't in the project's existing conventions. Focus effort proportionally: a race condition matters more than a variable name.
