# PRD: Token Usage Tracking

**Version:** 1.0.0
**Status:** Draft
**Author:** Josh / Claude
**Date:** 2026-02-27
**Package:** Plugin hooks + `@ai-team/kanban-viewer`

---

## 1. Overview

### 1.1 Background

The A(i)-Team runs missions that spawn 6-8 specialized agents (Face, Sosa, Murdock, B.A., Lynch, Amy, Tawnia) plus a Hannibal orchestrator. Each agent makes multiple API calls to Claude models (Opus, Sonnet, Haiku) across potentially dozens of conversation turns. A single mission can consume significant token budgets — but today there is no visibility into how much.

PRD-005 (Raw Agent Observability) explicitly placed token usage tracking out of scope: "Token usage tracking (Claude Code hooks do not currently expose token counts)." This was correct at the time — hook event payloads do not include token metrics. However, the `SubagentStop` hook provides `agent_transcript_path`, a JSONL file containing the full conversation transcript for each subagent. Every assistant message in those transcripts includes the Anthropic API's `usage` object:

```json
{
  "usage": {
    "input_tokens": 15230,
    "cache_creation_input_tokens": 5002,
    "cache_read_input_tokens": 12400,
    "output_tokens": 847,
    "service_tier": "standard"
  }
}
```

Similarly, the `Stop` hook provides `transcript_path` for the main Hannibal session. By parsing these transcripts at agent completion time, we can extract per-agent token usage without any changes to the Claude Code hook contract.

### 1.2 Problem Statement

Operators running A(i)-Team missions have no visibility into token costs. This causes three concrete problems:

1. **Cost attribution is impossible.** When a mission consumes $X in API credits, the operator cannot determine which agent or which feature item drove the cost. Was it Amy probing every feature with Opus-level thoroughness? Was it B.A. retrying failed implementations? Was it Hannibal's orchestration overhead? Without per-agent token data, cost optimization is guesswork.

2. **Budget planning is uninformed.** Teams considering the A(i)-Team for production use need to estimate per-mission and per-PR costs. Today the only way to get this data is to check the Anthropic dashboard before and after a mission — manual, imprecise, and impossible to break down by agent or feature.

3. **Model selection feedback is missing.** The pipeline uses different models for different agents (Opus for Face/Sosa/Lynch-Final, Sonnet for workers, Haiku for Tawnia). Without per-agent token data correlated with model, operators cannot evaluate whether model assignments are cost-effective — e.g., whether Sonnet for B.A. produces acceptable results vs. Haiku at 1/10th the cost.

### 1.3 Solution

Extend the existing hook observer infrastructure (PRD-005) to parse agent transcripts on `SubagentStop` and `Stop` events, extract cumulative token usage per agent turn, and store it alongside existing hook events. Aggregate per-mission totals on mission completion for dashboard display.

### 1.4 Scope

**In Scope:**
- Parsing agent transcript JSONL files to extract token usage from API response metadata
- Extending the HookEvent schema with token usage fields
- Capturing token usage on `SubagentStop` (per-agent) and `Stop` (Hannibal) events
- New `MissionTokenUsage` summary record aggregated from hook events on mission completion
- Dashboard widget showing per-agent and per-mission token costs
- Cost estimation using published Anthropic pricing tiers

**Out of Scope:**
- Real-time token streaming (tokens are captured at agent completion, not per-turn)
- Modifying Claude Code's hook system or requesting new hook fields from Anthropic
- Billing integration or spend alerts (future PRD)
- Token usage for non-A(i)-Team Claude Code sessions
- Historical trend analysis across missions (future — requires data to accumulate first)

---

## 2. Goals & Success Metrics

| Goal | Metric | Target |
|------|--------|--------|
| Per-agent token visibility | Token counts available for every agent in every mission | 100% of SubagentStop events include token data |
| Per-mission cost summary | Aggregated cost displayed on mission completion | Available within 5 seconds of mission archive |
| Model attribution | Token usage broken down by model (Opus/Sonnet/Haiku) | Model captured for every agent session |
| Zero overhead on agent execution | Transcript parsing time | < 500ms per agent (transcripts are local files, not network) |

**Negative metric (must NOT degrade):**
- Hook script execution time shall not increase measurably. Transcript parsing happens in the fire-and-forget POST — it must not block the agent's completion signal.

---

## 3. User Stories

**As an** operator who just completed a mission, **I want** to see how many tokens each agent consumed and the estimated cost **so that** I can understand mission economics and budget for future missions.

**As a** team lead evaluating the A(i)-Team for my team, **I want** to see per-PR cost data **so that** I can make an informed decision about adoption and set cost expectations.

**As a** developer optimizing agent configurations, **I want** to see token usage broken down by model (Opus vs. Sonnet vs. Haiku) per agent **so that** I can evaluate whether model assignments are cost-effective.

**As an** operator debugging an expensive mission, **I want** to see which agent consumed the most tokens and correlate that with the work items it processed **so that** I can identify whether the cost was justified or indicates a problem (e.g., retry loops, excessive context).

---

## 4. Requirements

### 4.1 Functional Requirements

#### Token Extraction from Transcripts

1. On `SubagentStop`, the hook script shall read the `agent_transcript_path` field from stdin and parse the JSONL transcript file.

2. On `Stop`, the hook script shall read the `transcript_path` field from stdin and parse the main session transcript to capture Hannibal's token usage.

3. For each transcript, the parser shall iterate all lines, identify assistant messages (entries with `message.usage`), and sum the following fields:
   - `input_tokens` — prompt tokens (excluding cache)
   - `output_tokens` — completion tokens
   - `cache_creation_input_tokens` — tokens written to cache
   - `cache_read_input_tokens` — tokens served from cache

4. The parser shall extract the `model` field from assistant messages (e.g., `claude-opus-4-5-20251101`, `claude-sonnet-4-6`).

5. If the transcript file is unreadable, missing, or contains no usage data, the hook script shall still send the event without token data (graceful degradation). Token capture is best-effort.

#### HookEvent Schema Extension

6. The `HookEvent` model shall be extended with the following nullable fields:
   - `inputTokens` (Int?) — total prompt tokens
   - `outputTokens` (Int?) — total completion tokens
   - `cacheCreationTokens` (Int?) — total cache write tokens
   - `cacheReadTokens` (Int?) — total cache read tokens
   - `model` (String?) — model identifier used by the agent

7. These fields shall only be populated on `subagent_stop` and `stop` event types. Other event types (pre_tool_use, post_tool_use, etc.) shall leave them null.

#### Mission-Level Aggregation

8. On mission completion (when all items reach `done` and post-checks pass), the system shall aggregate token usage from all hook events for that mission into a `MissionTokenUsage` summary.

9. The `MissionTokenUsage` record shall contain:
   - `missionId` — reference to the mission
   - `projectId` — reference to the project
   - Per-agent breakdown: `agentName`, `model`, `inputTokens`, `outputTokens`, `cacheCreationTokens`, `cacheReadTokens`
   - Mission totals: sum across all agents
   - `estimatedCostUsd` — calculated from token counts and model pricing

10. The aggregation shall be triggered by the existing mission completion flow (after Lynch-Final review and post-checks, before Tawnia's documentation commit).

#### Cost Estimation

11. The system shall estimate USD cost from token counts using a pricing table. The pricing table shall be a configuration file (not hardcoded) to allow updates as Anthropic changes pricing.

12. The pricing table shall be stored in the target project's `ateam.config.json` under a `pricing` key. It shall include rates for:
    - Input tokens (per 1M tokens, by model)
    - Output tokens (per 1M tokens, by model)
    - Cache creation tokens (per 1M tokens, by model — same as input rate)
    - Cache read tokens (per 1M tokens, by model — discounted rate)

13. The system shall use the model string from transcripts to look up pricing. Unrecognized models shall use a fallback rate and log a warning.

#### Dashboard Display

14. The kanban-viewer shall display a "Token Usage" section on mission completion, showing:
    - Total mission cost (estimated USD)
    - Per-agent breakdown table: agent name, model, input/output/cache tokens, estimated cost
    - Visual bar chart or proportional indicator showing relative cost by agent

15. The per-agent breakdown shall be sortable by cost (descending by default).

16. Token data shall be available via the existing SSE infrastructure — a new `mission-token-usage` event emitted when aggregation completes.

### 4.2 Non-Functional Requirements

1. Transcript parsing shall complete in under 500ms per agent. Typical agent transcripts are 50-500 JSONL lines; parsing is CPU-bound (JSON.parse per line, sum integers), not I/O-bound.

2. The `SubagentStop` hook script shall remain non-blocking. Transcript parsing and the API POST happen in the same fire-and-forget pattern as existing observer hooks — the hook exits without waiting for a response.

3. The `MissionTokenUsage` aggregation query shall complete in under 1 second. It is a simple `GROUP BY agentName, model` with `SUM()` on integer columns over at most ~50 hook events per mission.

4. Pricing configuration shall be updatable without code changes (lives in the project's `ateam.config.json`).

---

## 5. Data Model

### 5.1 HookEvent Extension

New nullable columns added to the existing `HookEvent` model:

```
HookEvent (existing model — new fields only):
  inputTokens         Int?      Total prompt tokens (excluding cache)
  outputTokens        Int?      Total completion tokens
  cacheCreationTokens Int?      Tokens written to prompt cache
  cacheReadTokens     Int?      Tokens served from prompt cache
  model               String?   Model identifier (e.g., "claude-sonnet-4-6")
```

These fields are populated only on `subagent_stop` and `stop` events. All other event types leave them null. This keeps the existing HookEvent table as the single source of truth — no joins required for per-agent token queries.

### 5.2 MissionTokenUsage (New Model)

```
MissionTokenUsage:
  id                  Auto-generated
  missionId           String    → Mission
  projectId           String    → Project
  agentName           String    Agent name (murdock, ba, lynch, etc.)
  model               String    Model identifier
  inputTokens         Int       Sum of input tokens for this agent+model
  outputTokens        Int       Sum of output tokens for this agent+model
  cacheCreationTokens Int       Sum of cache creation tokens
  cacheReadTokens     Int       Sum of cache read tokens
  estimatedCostUsd    Float     Calculated cost in USD
  createdAt           DateTime  When the aggregation ran

  @@unique([missionId, agentName, model])
  @@index([missionId])
  @@index([projectId])
```

One row per agent-model combination per mission. A mission with 8 agents across 2 models produces ~10 rows. The `@@unique` constraint allows upsert on re-aggregation (e.g., if a mission is re-run or post-checks trigger additional agent work).

### 5.3 Pricing Configuration (in `ateam.config.json`)

The pricing table lives in the target project's `ateam.config.json` under a `pricing` key:

```json
{
  "pricing": {
    "models": {
      "claude-opus-4-5-20251101": {
        "input_per_1m": 15.00,
        "output_per_1m": 75.00,
        "cache_read_per_1m": 1.50
      },
      "claude-sonnet-4-6": {
        "input_per_1m": 3.00,
        "output_per_1m": 15.00,
        "cache_read_per_1m": 0.30
      },
      "claude-haiku-4-5-20251001": {
        "input_per_1m": 0.80,
        "output_per_1m": 4.00,
        "cache_read_per_1m": 0.08
      }
    },
    "fallback": {
      "input_per_1m": 3.00,
      "output_per_1m": 15.00,
      "cache_read_per_1m": 0.30
    }
  }
}
```

Cache creation tokens are charged at the same rate as input tokens. Cache read tokens use the discounted `cache_read_per_1m` rate. The `fallback` entry covers unrecognized model strings. This co-locates pricing with other A(i)-Team project configuration and is editable without touching the plugin or requiring a database migration.

---

## 6. Architecture

### 6.1 Data Flow

```
Agent Completes
       │
       ▼
SubagentStop fires
       │
       ├─ stdin: { agent_transcript_path, agent_type, ... }
       │
       ▼
observe-subagent.js
       │
       ├─ readFileSync(agent_transcript_path)
       ├─ parse JSONL, sum usage fields
       ├─ extract model from assistant messages
       │
       ▼
POST /api/hooks/events
  {
    eventType: "subagent_stop",
    agentName: "murdock",
    inputTokens: 45230,
    outputTokens: 3847,
    cacheCreationTokens: 5002,
    cacheReadTokens: 32100,
    model: "claude-sonnet-4-6",
    ...existing fields...
  }
       │
       ▼
SQLite (HookEvent row)
       │
       │  ... all agents complete, mission finishes ...
       │
       ▼
Mission Completion
       │
       ├─ SELECT agentName, model,
       │    SUM(inputTokens), SUM(outputTokens),
       │    SUM(cacheCreationTokens), SUM(cacheReadTokens)
       │  FROM HookEvent
       │  WHERE missionId = ? AND eventType IN ('subagent_stop', 'stop')
       │  GROUP BY agentName, model
       │
       ▼
MissionTokenUsage rows (with estimatedCostUsd)
       │
       ▼
SSE: mission-token-usage event → Dashboard
```

### 6.2 Integration Points

| Component | Existing | Change |
|-----------|----------|--------|
| `observe-subagent.js` | Sends subagent_start/stop events | Add transcript parsing, include token fields |
| `observe-stop.js` | Sends stop event | Add transcript parsing for Hannibal |
| `POST /api/hooks/events` | Accepts hook events | Accept new nullable token fields |
| HookEvent Prisma model | 13 fields | Add 5 nullable fields |
| SSE endpoint | 15 event types | Add `mission-token-usage` event type |
| Mission completion flow | Lynch-Final → post-checks → Tawnia | Add aggregation step between post-checks and Tawnia |

### 6.3 Transcript Parsing

The parser is intentionally simple — a line-by-line JSONL reader that sums integers:

```js
function parseTranscriptUsage(transcriptPath) {
  const lines = readFileSync(transcriptPath, 'utf8').split('\n').filter(Boolean);

  let inputTokens = 0;
  let outputTokens = 0;
  let cacheCreationTokens = 0;
  let cacheReadTokens = 0;
  let model = null;

  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      const usage = entry.message?.usage;
      if (usage) {
        inputTokens += usage.input_tokens || 0;
        outputTokens += usage.output_tokens || 0;
        cacheCreationTokens += usage.cache_creation_input_tokens || 0;
        cacheReadTokens += usage.cache_read_input_tokens || 0;
      }
      if (entry.message?.model) {
        model = entry.message.model;
      }
    } catch {
      // Skip malformed lines
    }
  }

  return { inputTokens, outputTokens, cacheCreationTokens, cacheReadTokens, model };
}
```

This runs synchronously in the hook script. For a 500-line transcript (~typical for a Sonnet worker agent), this completes in <50ms on a modern machine.

---

## 7. Edge Cases & Error States

- **Transcript file missing or unreadable.** The `agent_transcript_path` may point to a file that was already cleaned up or is in a temporary directory that got purged. The hook script shall catch the error, log to stderr, and send the event without token fields. Partial data is better than no event.

- **Transcript contains no assistant messages.** This can happen if an agent was spawned but immediately errored out. The parser returns zeros for all fields and null for model. The event is still sent — it records the agent completed with zero tokens consumed.

- **Multiple models in one transcript.** An agent session could theoretically use different models (e.g., if the model was switched mid-session). The parser captures the last model encountered. This is a simplification — for the expected A(i)-Team usage patterns, each agent uses exactly one model throughout its session.

- **Hannibal's transcript is very large.** Hannibal runs for the entire mission and may accumulate thousands of turns. The parser still reads line-by-line; on a 10,000-line transcript, parsing takes ~200ms. This is acceptable since the `Stop` hook fires only once at mission end.

- **Mission with no SubagentStop events.** If a mission fails before any agents complete, there are no token records to aggregate. The `MissionTokenUsage` table has zero rows for that mission. The dashboard shows "No token data available."

- **Re-aggregation.** If post-checks fail and the mission re-runs some agents, new `SubagentStop` events are created. The aggregation uses the `@@unique([missionId, agentName, model])` constraint to upsert — re-aggregation replaces previous totals for that agent+model combination with updated sums.

- **Cost estimation for new models.** If Anthropic releases a new model and the pricing config hasn't been updated, the system uses the `fallback` pricing entry and logs a warning. This avoids zero-cost entries that would undercount mission costs.

- **Concurrent missions across projects.** Token data is scoped by `projectId` and `missionId`. Cross-project contamination is impossible — the same isolation that works for hook events applies to token data.

---

## 8. Dependencies

### Internal

| Dependency | Owner | Status |
|------------|-------|--------|
| Hook observer infrastructure (PRD-005) | Plugin hooks | Shipped — `observe-subagent.js`, `observe-stop.js` exist |
| HookEvent Prisma model | kanban-viewer | Shipped — needs migration for new fields |
| SSE infrastructure | kanban-viewer | Shipped — needs new event type |
| Mission completion flow | Plugin orchestration | Shipped — needs aggregation step |
| `useBoardEvents` hook | kanban-viewer | Shipped — needs new callback |

### External

| Dependency | Notes |
|------------|-------|
| Claude Code `SubagentStop` hook providing `agent_transcript_path` | Confirmed available — field documented in Claude Code hooks reference |
| Claude Code `Stop` hook providing `transcript_path` | Confirmed available — field documented in Claude Code hooks reference |
| Transcript JSONL format including `message.usage` | Confirmed — verified by reading actual transcript files |
| Anthropic API usage fields (`input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`) | Stable — part of the Anthropic Messages API response format |

---

## 9. Risks & Open Questions

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Transcript format changes in future Claude Code versions | Low | Parser breaks, no token data | Parser is defensive (try/catch per line, null on failure). Monitor after Claude Code updates |
| Large transcript files slow down hook script | Low | Hook takes >500ms | Parse only `message.usage` fields — skip full content. For Hannibal's transcript, consider streaming read |
| Anthropic pricing changes | Medium | Cost estimates become inaccurate | Pricing lives in project's `ateam.config.json`, not hardcoded. Update config when pricing changes |
| `cache_creation_input_tokens` field semantics change | Low | Cost calculation wrong | Pin to documented Anthropic API semantics. The field has been stable since prompt caching launch |
| Mission re-runs cause double-counting | Medium | Inflated cost totals | Aggregation uses upsert with `@@unique` constraint — re-aggregation replaces, doesn't add |

### Open Questions

- [x] ~~Should the aggregation step be triggered by Hannibal (orchestrator) as part of mission completion, or by a dedicated API endpoint that Tawnia calls before committing?~~ **Decision:** Hannibal triggers it after post-checks pass, before spawning Tawnia — this keeps the data available for Tawnia to include in the commit message.
- [x] ~~Should the pricing config live in the kanban-viewer database (editable via UI), as a JSON file in the plugin, or in the kanban-viewer's config?~~ **Decision:** Lives in the target project's `ateam.config.json` file. This keeps pricing co-located with the project's other A(i)-Team configuration and is editable without touching the plugin or database.
- [x] ~~Should we track token usage for the `Stop` event (Hannibal) separately from subagents, or attribute Hannibal's tokens to the mission as a whole?~~ **Decision:** Track separately with `agentName: "hannibal"` — this lets operators see orchestration overhead vs. worker cost.
- [x] ~~Should we include token data in the mission's final commit message (via Tawnia)?~~ **Decision:** Yes. Token counts (not cost estimates) in the commit message. Format: "Tokens: 1.2M input, 45K output (Opus: 820K/32K, Sonnet: 350K/12K, Haiku: 30K/1K)".

---

## 10. Work Items

### 10.1 Wave 1: Schema and Hook Changes

#### WI-001: Extend HookEvent model with token usage fields

**Type:** task
**Priority:** high

**Description:**
Add five nullable columns to the existing `HookEvent` Prisma model: `inputTokens`, `outputTokens`, `cacheCreationTokens`, `cacheReadTokens`, and `model`. Create and run the migration.

**Acceptance Criteria:**
- [ ] Five new nullable fields added to `HookEvent` in `prisma/schema.prisma`
- [ ] Migration runs successfully against SQLite
- [ ] Existing hook events are unaffected (new fields are null for all existing rows)
- [ ] `POST /api/hooks/events` endpoint accepts the new fields
- [ ] TypeScript types updated (`HookEventSummary` or equivalent)

---

#### WI-002: Add transcript parsing to observe-subagent.js

**Type:** feature
**Priority:** high
**Dependencies:** WI-001

**Description:**
Extend the `SubagentStop` handler in `observe-subagent.js` to read `agent_transcript_path` from stdin, parse the JSONL transcript, sum token usage fields across all assistant messages, extract the model, and include these in the POST payload.

**Acceptance Criteria:**
- [ ] On `SubagentStop`, reads `agent_transcript_path` from hook stdin JSON
- [ ] Parses JSONL transcript and sums `input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`
- [ ] Extracts `model` from assistant messages
- [ ] Includes `inputTokens`, `outputTokens`, `cacheCreationTokens`, `cacheReadTokens`, `model` in POST payload
- [ ] Gracefully handles missing/unreadable transcripts (sends event without token data)
- [ ] Parsing completes in under 500ms for transcripts up to 1000 lines
- [ ] Existing `subagent_stop` event behavior is preserved (agent name, summary, correlation ID)

---

#### WI-003: Add transcript parsing to observe-stop.js

**Type:** feature
**Priority:** high
**Dependencies:** WI-001

**Description:**
Extend `observe-stop.js` to read `transcript_path` from stdin, parse Hannibal's session transcript, and include cumulative token usage in the stop event POST.

**Acceptance Criteria:**
- [ ] On `Stop`, reads `transcript_path` from hook stdin JSON
- [ ] Parses JSONL transcript and sums token usage across all assistant messages
- [ ] Extracts `model` from assistant messages
- [ ] Includes token fields in POST payload with `agentName: "hannibal"`
- [ ] Handles large transcripts (1000+ lines) within 500ms
- [ ] Graceful fallback if transcript is unreadable

---

### 10.2 Wave 2: Aggregation and Pricing

#### WI-004: Create MissionTokenUsage model and pricing config

**Type:** task
**Priority:** high
**Dependencies:** WI-001

**Description:**
Add the `MissionTokenUsage` Prisma model and define the pricing configuration schema for `ateam.config.json`. The model stores per-agent-per-model token aggregates for completed missions.

**Acceptance Criteria:**
- [ ] `MissionTokenUsage` model added to Prisma schema with fields per Section 5.2
- [ ] `@@unique([missionId, agentName, model])` constraint for upsert support
- [ ] Migration runs successfully
- [ ] Pricing schema documented; default `pricing` block added to `ateam.config.json` during `/ai-team:setup`
- [ ] Pricing config includes `fallback` entry for unrecognized models

---

#### WI-005: Implement mission token aggregation endpoint

**Type:** feature
**Priority:** high
**Dependencies:** WI-004

**Description:**
Create an API endpoint (or extend mission completion logic) that aggregates token usage from `HookEvent` rows into `MissionTokenUsage` rows. The aggregation groups by `agentName` and `model`, sums token fields, and calculates estimated USD cost from the pricing config.

**Acceptance Criteria:**
- [ ] Aggregation queries `HookEvent` for the mission's `subagent_stop` and `stop` events
- [ ] Groups by `agentName, model` and sums all four token fields
- [ ] Looks up pricing from `ateam.config.json` `pricing` block and calculates `estimatedCostUsd`
- [ ] Uses upsert (not insert) to handle re-aggregation
- [ ] Unrecognized models use fallback pricing and log a warning
- [ ] Returns the full breakdown (per-agent rows + mission total)

---

#### WI-006: Integrate aggregation into mission completion flow

**Type:** task
**Priority:** high
**Dependencies:** WI-005

**Description:**
Wire the token aggregation into the existing mission completion pipeline. Aggregation should run after post-checks pass and before Tawnia is spawned, so the data is available for documentation.

**Acceptance Criteria:**
- [ ] Aggregation triggers automatically on mission completion
- [ ] Runs after post-checks, before Tawnia
- [ ] Emits `mission-token-usage` SSE event with the full breakdown
- [ ] `useBoardEvents` hook supports `onMissionTokenUsage` callback
- [ ] Aggregation failure does not block Tawnia or mission completion (best-effort)

---

### 10.3 Wave 3: Dashboard

#### WI-007: Add token usage display to mission completion view

**Type:** feature
**Priority:** medium
**Dependencies:** WI-006

**Description:**
Add a "Token Usage" section to the kanban-viewer that appears on mission completion. Shows total estimated cost, per-agent breakdown with model and token counts, and a visual proportional indicator.

**Acceptance Criteria:**
- [ ] Displays total mission cost prominently (e.g., "Mission cost: ~$2.47")
- [ ] Per-agent breakdown table: agent name, model, input/output/cache tokens, cost
- [ ] Table sorted by cost descending by default
- [ ] Visual proportional indicator (bar chart or similar) showing relative cost by agent
- [ ] Handles missions with no token data gracefully ("No token data available")
- [ ] Receives data via SSE `mission-token-usage` event

---

#### WI-008: Add token summary to Tawnia's commit context

**Type:** enhancement
**Priority:** medium
**Dependencies:** WI-006

**Description:**
Make the aggregated token usage available to Tawnia so she can include a token count summary in the CHANGELOG entry or commit message for the mission. Token counts are facts that belong in version history; cost estimates are derived and belong only in the dashboard.

**Acceptance Criteria:**
- [ ] Tawnia receives token usage data (via MCP tool or passed in prompt context)
- [ ] Commit message or CHANGELOG includes a one-line token usage summary
- [ ] Format: "Tokens: 1.2M input, 45K output (Opus: 820K/32K, Sonnet: 350K/12K, Haiku: 30K/1K)"
- [ ] Omits model tiers with zero tokens
- [ ] No cost/dollar amounts in the commit — only raw token counts

---

## 11. Wave Dependencies

```
Wave 1 (Schema + Hooks)
WI-001 (HookEvent migration) ─────────────────┐
  │                                             │
  ├──► WI-002 (observe-subagent.js tokens)     │
  └──► WI-003 (observe-stop.js tokens)         │
                                                │
Wave 2 (Aggregation)                            │
WI-004 (MissionTokenUsage + pricing) ◄─────────┘
  │
  └──► WI-005 (aggregation endpoint)
          │
          └──► WI-006 (mission completion integration)

Wave 3 (Dashboard)
WI-007 (token usage display) ◄── WI-006
WI-008 (Tawnia commit context) ◄── WI-006
```

Wave 1 items (WI-002 and WI-003) can run in parallel once WI-001 is complete. Wave 2 depends on the schema from Wave 1 but not on the hook scripts. Wave 3 depends on Wave 2's aggregation. WI-007 and WI-008 can run in parallel.

---

## 12. Success Criteria

Token Usage Tracking is complete when:

1. **Per-agent visibility** — Every `subagent_stop` and `stop` hook event includes token counts extracted from the agent's transcript
2. **Per-mission cost** — On mission completion, a `MissionTokenUsage` summary is computed with estimated USD cost per agent
3. **Dashboard display** — The kanban-viewer shows mission cost and per-agent breakdown on mission completion
4. **Cost accuracy** — Estimated costs match Anthropic dashboard billing to within 10% (accounting for rounding and pricing tier differences)
5. **Zero overhead** — Transcript parsing adds no perceptible delay to agent completion (< 500ms)
6. **Graceful degradation** — Missing transcripts, unrecognized models, and aggregation failures never block mission execution
