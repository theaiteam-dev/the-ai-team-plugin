# Claude Code Hook System Audit

**Date:** 2026-02-16
**Auditor:** B.A. (Implementer)
**Purpose:** Document available Claude Code hook types, payloads, and capabilities for PRD-0005 implementation

---

## Executive Summary

Claude Code provides **14 distinct hook events** spanning the entire agent lifecycle, from session initialization through tool execution to session termination. All hook types receive JSON input via the `TOOL_INPUT` environment variable and can influence agent behavior through exit codes and JSON output.

**Key Finding:** The hook system is **more capable than initially assumed** in PRD-0005. Post-execution hooks provide detailed tool output data, timing must be manual (no duration field), and correlation between Pre/Post hooks requires manual correlation via `tool_use_id`.

---

## Available Hook Types

### Lifecycle Hooks

| Hook Event | When It Fires | Can Block? | Matcher Support |
|------------|---------------|------------|-----------------|
| `SessionStart` | Session begins or resumes | No | Yes (startup, resume, clear, compact) |
| `SessionEnd` | Session terminates | No | Yes (clear, logout, prompt_input_exit, bypass_permissions_disabled, other) |
| `PreCompact` | Before context compaction | No | Yes (manual, auto) |

### User Interaction Hooks

| Hook Event | When It Fires | Can Block? | Matcher Support |
|------------|---------------|------------|-----------------|
| `UserPromptSubmit` | User submits prompt, before Claude processes | **Yes** | No (always fires) |
| `Notification` | Claude Code sends notification | No | Yes (permission_prompt, idle_prompt, auth_success, elicitation_dialog) |

### Tool Execution Hooks

| Hook Event | When It Fires | Can Block? | Matcher Support |
|------------|---------------|------------|-----------------|
| `PreToolUse` | Before tool executes | **Yes** | Yes (tool name) |
| `PostToolUse` | After tool succeeds | No* | Yes (tool name) |
| `PostToolUseFailure` | After tool fails | No* | Yes (tool name) |
| `PermissionRequest` | Permission dialog appears | **Yes** | Yes (tool name) |

*Can inject feedback to Claude but cannot prevent the already-completed action

### Agent Lifecycle Hooks

| Hook Event | When It Fires | Can Block? | Matcher Support |
|------------|---------------|------------|-----------------|
| `SubagentStart` | Subagent spawns | No | Yes (agent type) |
| `SubagentStop` | Subagent finishes | **Yes** | Yes (agent type) |
| `Stop` | Main agent finishes responding | **Yes** | No (always fires) |
| `TeammateIdle` | Teammate about to go idle (native teams) | **Yes** | No (always fires) |
| `TaskCompleted` | Task marked completed | **Yes** | No (always fires) |

---

## Payload Format

### Common Input Fields (All Events)

All hooks receive these fields via the `TOOL_INPUT` environment variable as a JSON string:

```json
{
  "session_id": "abc123",
  "transcript_path": "/path/to/transcript.jsonl",
  "cwd": "/current/working/directory",
  "permission_mode": "default",
  "hook_event_name": "PreToolUse"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `session_id` | string | Current session identifier |
| `transcript_path` | string | Path to conversation JSON |
| `cwd` | string | Current working directory |
| `permission_mode` | enum | "default", "plan", "acceptEdits", "dontAsk", or "bypassPermissions" |
| `hook_event_name` | string | Name of the event that fired |

### Tool Event Fields (PreToolUse, PostToolUse, PostToolUseFailure, PermissionRequest)

**PreToolUse:**
```json
{
  "tool_name": "Bash",
  "tool_input": {
    "command": "npm test",
    "description": "Run test suite",
    "timeout": 120000
  },
  "tool_use_id": "toolu_01ABC123..."
}
```

**PostToolUse:**
```json
{
  "tool_name": "Write",
  "tool_input": {
    "file_path": "/path/to/file.txt",
    "content": "file content"
  },
  "tool_response": {
    "filePath": "/path/to/file.txt",
    "success": true
  },
  "tool_use_id": "toolu_01ABC123..."
}
```

**PostToolUseFailure:**
```json
{
  "tool_name": "Bash",
  "tool_input": { ... },
  "tool_use_id": "toolu_01ABC123...",
  "error": "Command exited with non-zero status code 1",
  "is_interrupt": false
}
```

**Key Observation:** PostToolUse provides both `tool_input` AND `tool_response`, enabling rich telemetry.

### Agent Lifecycle Fields

**SubagentStart:**
```json
{
  "agent_id": "agent-abc123",
  "agent_type": "Explore"
}
```

**SubagentStop:**
```json
{
  "stop_hook_active": false,
  "agent_id": "def456",
  "agent_type": "Explore",
  "agent_transcript_path": "~/.claude/projects/.../abc123/subagents/agent-def456.jsonl"
}
```

**Stop:**
```json
{
  "stop_hook_active": true
}
```

**TeammateIdle:**
```json
{
  "teammate_name": "researcher",
  "team_name": "my-project"
}
```

**TaskCompleted:**
```json
{
  "task_id": "task-001",
  "task_subject": "Implement user authentication",
  "task_description": "Add login and signup endpoints",
  "teammate_name": "implementer",
  "team_name": "my-project"
}
```

---

## Output Format

### Exit Codes

| Exit Code | Meaning | Effect |
|-----------|---------|--------|
| `0` | Success | Parse stdout for JSON, allow action to proceed |
| `2` | Blocking error | Ignore stdout, feed stderr to Claude, block action (if blockable) |
| Other | Non-blocking error | Show stderr in verbose mode, continue |

**Exit Code 2 Behavior:**
- **PreToolUse, PermissionRequest, UserPromptSubmit:** Blocks the action
- **Stop, SubagentStop, TeammateIdle, TaskCompleted:** Prevents stopping/completion
- **PostToolUse, PostToolUseFailure, Notification, SessionStart, SessionEnd, SubagentStart, PreCompact:** Shows stderr only (action already happened)

### Universal JSON Output Fields

Exit 0 to return JSON. All events support these fields:

```json
{
  "continue": true,
  "stopReason": "Build failed, fix errors before continuing",
  "suppressOutput": false,
  "systemMessage": "Warning message for user"
}
```

| Field | Default | Description |
|-------|---------|-------------|
| `continue` | `true` | If `false`, Claude stops processing entirely |
| `stopReason` | none | Message shown when `continue` is `false` |
| `suppressOutput` | `false` | Hide stdout from verbose mode |
| `systemMessage` | none | Warning message shown to user |

### Event-Specific Decision Control

**Top-level `decision` field** (UserPromptSubmit, PostToolUse, PostToolUseFailure, Stop, SubagentStop):
```json
{
  "decision": "block",
  "reason": "Test suite must pass before proceeding"
}
```

**PreToolUse (`hookSpecificOutput`):**
```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "Database writes are not allowed",
    "updatedInput": { ... },
    "additionalContext": "Current environment: production"
  }
}
```

| Field | Values | Description |
|-------|--------|-------------|
| `permissionDecision` | "allow", "deny", "ask" | Control tool execution |
| `permissionDecisionReason` | string | Explanation (shown to Claude for "deny") |
| `updatedInput` | object | Modify tool parameters before execution |
| `additionalContext` | string | Inject context for Claude |

**PermissionRequest (`hookSpecificOutput`):**
```json
{
  "hookSpecificOutput": {
    "hookEventName": "PermissionRequest",
    "decision": {
      "behavior": "allow",
      "updatedInput": { ... },
      "updatedPermissions": { ... },
      "message": "Permission denied",
      "interrupt": true
    }
  }
}
```

---

## Correlation Mechanism: Pre/Post Hook Pairing

### Answer to PRD Section 8 Question

**Q: How do we pair PreToolUse with PostToolUse for timing?**

**A: Use the `tool_use_id` field.**

Both PreToolUse and PostToolUse receive the same `tool_use_id` value:

```json
// PreToolUse
{
  "tool_name": "Bash",
  "tool_use_id": "toolu_01ABC123..."
}

// PostToolUse
{
  "tool_name": "Bash",
  "tool_use_id": "toolu_01ABC123..."  // SAME ID
}
```

**Correlation Strategy:**
1. PreToolUse writes `tool_use_id` + timestamp to a temp file (e.g., `/tmp/claude-tool-timings.json`)
2. PostToolUse reads the file, looks up the matching `tool_use_id`, calculates duration
3. PostToolUse appends telemetry record with duration

**Alternative:** Use environment variables if Claude Code supports cross-hook state (not documented, likely unsupported).

---

## Duration Data: Manual Timing Required

**Q: Does PostToolUse provide duration data automatically?**

**A: No.** PostToolUse provides `tool_input` and `tool_response` but **no timing information**.

To measure tool duration:
- PreToolUse: Record timestamp + `tool_use_id`
- PostToolUse: Look up start time, calculate `end_time - start_time`

**Implementation:**
```javascript
const { readFileSync, appendFileSync } = require('fs');

// PreToolUse hook (record-tool-start.js)
const input = JSON.parse(readFileSync(0, 'utf8'));
const record = {
  tool_use_id: input.tool_use_id,
  start_time: Date.now(),
  tool_name: input.tool_name
};
appendFileSync('/tmp/tool-timings.jsonl', JSON.stringify(record) + '\n');
process.exit(0);

// PostToolUse hook (record-tool-end.js)
const input = JSON.parse(readFileSync(0, 'utf8'));
const timings = readFileSync('/tmp/tool-timings.jsonl', 'utf-8')
  .split('\n')
  .filter(Boolean)
  .map(JSON.parse);

const start = timings.find(t => t.tool_use_id === input.tool_use_id);
if (start) {
  const duration_ms = Date.now() - start.start_time;
  const telemetry = {
    tool_use_id: input.tool_use_id,
    tool_name: input.tool_name,
    duration_ms,
    success: true
  };
  appendFileSync('/tmp/tool-telemetry.jsonl', JSON.stringify(telemetry) + '\n');
}
process.exit(0);
```

---

## Permission Denials: PostToolUseFailure Distinguishes Errors

**Q: Does PostToolUseFailure distinguish permission denials from other errors?**

**A: Not explicitly, but the `error` field contains descriptive text.**

PostToolUseFailure provides:
```json
{
  "error": "Command exited with non-zero status code 1",
  "is_interrupt": false
}
```

**Detection Strategy:**
- Parse the `error` string for keywords like "permission", "denied", "auto-denied"
- The `is_interrupt` field differentiates user interruptions from failures
- For robust detection, check common permission error patterns:
  ```javascript
  const isPermissionDenied =
    input.error.includes('auto-denied') ||
    input.error.includes('permission denied') ||
    input.error.includes('Permission to use');
  ```

---

## SubagentStart/SubagentStop Payloads

**SubagentStart:**
```json
{
  "agent_id": "agent-abc123",
  "agent_type": "Explore"
}
```

**SubagentStop:**
```json
{
  "stop_hook_active": false,
  "agent_id": "def456",
  "agent_type": "Explore",
  "agent_transcript_path": "~/.claude/projects/.../abc123/subagents/agent-def456.jsonl"
}
```

**Key Fields:**
- `agent_type`: Matcher value (built-in: "Bash", "Explore", "Plan", or custom agent names)
- `agent_id`: Unique identifier for this subagent instance
- `agent_transcript_path`: Path to subagent's transcript (SubagentStop only)
- `stop_hook_active`: Whether this is a repeated stop attempt (SubagentStop only)

**Usage:**
- SubagentStart: Inject context into the subagent via `additionalContext` JSON field
- SubagentStop: Block subagent completion via `decision: "block"`, extract agent output from transcript

---

## Tool Input Schemas (Per Tool)

### Bash
```json
{
  "command": "npm test",
  "description": "Run test suite",
  "timeout": 120000,
  "run_in_background": false
}
```

### Write
```json
{
  "file_path": "/path/to/file.txt",
  "content": "file content"
}
```

### Edit
```json
{
  "file_path": "/path/to/file.txt",
  "old_string": "original text",
  "new_string": "replacement text",
  "replace_all": false
}
```

### Read
```json
{
  "file_path": "/path/to/file.txt",
  "offset": 10,
  "limit": 50
}
```

### Glob
```json
{
  "pattern": "**/*.ts",
  "path": "/path/to/dir"
}
```

### Grep
```json
{
  "pattern": "TODO.*fix",
  "path": "/path/to/dir",
  "glob": "*.ts",
  "output_mode": "content",
  "-i": true,
  "multiline": false
}
```

### WebFetch
```json
{
  "url": "https://example.com/api",
  "prompt": "Extract the API endpoints"
}
```

### WebSearch
```json
{
  "query": "react hooks best practices",
  "allowed_domains": ["docs.example.com"],
  "blocked_domains": ["spam.example.com"]
}
```

### Task
```json
{
  "prompt": "Find all API endpoints",
  "description": "Find API endpoints",
  "subagent_type": "Explore",
  "model": "sonnet"
}
```

---

## Hook Input: stdin JSON

**IMPORTANT:** Claude Code sends hook context via **stdin as JSON**, NOT as environment variables. All hook scripts must read from stdin:

```javascript
const { readFileSync } = require('fs');
const input = JSON.parse(readFileSync(0, 'utf8'));
```

The stdin JSON contains fields like `tool_name`, `tool_input`, `hook_event_name`, `session_id`, `cwd`, etc.

### Environment Variables

The only env vars available are:
- `CLAUDE_PROJECT_DIR`: Project root directory
- `CLAUDE_PLUGIN_ROOT`: Plugin root directory (for plugin hooks)
- `CLAUDE_CODE_REMOTE`: "true" in remote web environments, unset in CLI
- Settings from `settings.local.json` (e.g., `ATEAM_API_URL`, `ATEAM_PROJECT_ID`)

### SessionStart Only
- `CLAUDE_ENV_FILE`: Path to file for persisting environment variables across Bash commands

**Example (from existing codebase):**
```javascript
// scripts/hooks/block-raw-echo-log.js
const { readFileSync } = require('fs');
const input = JSON.parse(readFileSync(0, 'utf8'));
const command = (input.tool_input && input.tool_input.command) || '';
```

---

## Advanced Features

### Async Hooks (Command Hooks Only)

**Configuration:**
```json
{
  "type": "command",
  "command": "/path/to/run-tests.sh",
  "async": true,
  "timeout": 120
}
```

**Behavior:**
- Hook runs in background, Claude continues immediately
- Output delivered on next conversation turn
- **Cannot block or return decisions** (action already proceeded)
- Only `systemMessage` and `additionalContext` JSON fields are processed
- Only available for `type: "command"` hooks

### Prompt-Based Hooks

**Configuration:**
```json
{
  "type": "prompt",
  "prompt": "Evaluate if Claude should stop: $ARGUMENTS. Check if all tasks are complete.",
  "model": "sonnet",
  "timeout": 30
}
```

**Response Schema:**
```json
{
  "ok": true,
  "reason": "Explanation for the decision"
}
```

**Supported Events:** PreToolUse, PostToolUse, PostToolUseFailure, PermissionRequest, UserPromptSubmit, Stop, SubagentStop, TaskCompleted

### Agent-Based Hooks

**Configuration:**
```json
{
  "type": "agent",
  "prompt": "Verify that all unit tests pass. Run the test suite and check the results. $ARGUMENTS",
  "model": "sonnet",
  "timeout": 120
}
```

**Behavior:**
- Spawns subagent with Read, Grep, Glob access
- Multi-turn evaluation (up to 50 turns)
- Same response schema as prompt hooks: `{ "ok": true }` or `{ "ok": false, "reason": "..." }`

---

## Matcher Patterns

| Event Type | Matcher Filters On | Example Values |
|------------|-------------------|----------------|
| PreToolUse, PostToolUse, PostToolUseFailure, PermissionRequest | Tool name | `Bash`, `Edit\|Write`, `mcp__.*` |
| SessionStart | How session started | `startup`, `resume`, `clear`, `compact` |
| SessionEnd | Why session ended | `clear`, `logout`, `prompt_input_exit`, `bypass_permissions_disabled`, `other` |
| Notification | Notification type | `permission_prompt`, `idle_prompt`, `auth_success`, `elicitation_dialog` |
| SubagentStart, SubagentStop | Agent type | `Bash`, `Explore`, `Plan`, custom agent names |
| PreCompact | Trigger type | `manual`, `auto` |
| UserPromptSubmit, Stop, TeammateIdle, TaskCompleted | No matcher support | Always fires |

**Regex Support:** Matchers are regex strings. `Edit|Write` matches either tool. `mcp__.*` matches all MCP tools.

---

## Open Questions from PRD (Answered)

### 1. Available Hook Types
✅ **Answered:** 14 hook events documented above

### 2. PostToolUse Duration Data
✅ **Answered:** No automatic duration. Manual timing required via `tool_use_id` correlation.

### 3. PostToolUseFailure Permission Denial Detection
✅ **Answered:** Parse `error` field for keywords. No explicit boolean flag.

### 4. SubagentStart/SubagentStop Payloads
✅ **Answered:** See "SubagentStart/SubagentStop Payloads" section above.

### 5. Pre/Post Correlation Mechanism
✅ **Answered:** Use `tool_use_id` field. Write to shared temp file in PreToolUse, read in PostToolUse.

---

## Implementation Recommendations for PRD-0005

### Current Telemetry Implementation

The observer hooks now post telemetry events directly to the API via `scripts/hooks/lib/observer.js`:

**Implemented Hooks:**
1. **PreToolUse** (`observe-pre-tool-use.js`) - Records every tool call with agent, tool name, input
2. **PostToolUse** (`observe-post-tool-use.js`) - Records tool results and response data
3. **Stop** (`observe-stop.js`) - Records agent stop events
4. **SubagentStart/Stop** (`observe-subagent.js`) - Records subagent lifecycle in legacy mode
5. **TeammateIdle/TaskCompleted** (`observe-teammate.js`) - Records agent lifecycle in native teams mode

**Data Flow:**
- Observer hooks POST structured events to `POST /api/hooks/events` with `X-Project-ID` header
- Events include: agent name, tool name, event type, timestamps, token counts, model
- Token usage is aggregated per-mission via `POST /api/missions/{id}/token-usage`

### File Structure

```
scripts/hooks/
├── lib/
│   ├── observer.js              # Shared observer: POST events to API
│   ├── resolve-agent.js         # Agent identity resolution (resolveAgent, isKnownAgent)
│   └── send-denied-event.js     # Fire-and-forget denied event recording
├── observe-*.js                 # Telemetry observers (pre/post tool use, stop, subagent, teammate)
├── enforce-*.js                 # Completion/lifecycle enforcement hooks
├── block-*.js                   # Boundary enforcement hooks (PreToolUse)
├── lint-test-quality.js         # Test anti-pattern linter (B.A.)
├── track-browser-usage.js       # Browser tool tracker (Amy)
└── diagnostic-hook.js           # Debug/diagnostic hook
```

---

## Pool Enforcement Hooks (Pipeline Parallelism)

The pipeline parallelism feature introduced pool-based multi-instance agents and two new enforcement hooks:

### `enforce-agent-start.js`

**Type:** PreToolUse (global, registered in `hooks/hooks.json`)
**Purpose:** Blocks pipeline workers from performing work before calling `ateam agents-start agentStart`.
**Behavior:** Checks the transcript for evidence of a successful `agentStart` call. Fails open for unknown agents.

### `enforce-handoff.js`

**Type:** Stop (per-agent, registered in frontmatter for Murdock, B.A., Lynch, Amy)
**Purpose:** Validates that pipeline workers complete the full lifecycle before stopping:
1. Called `ateam agents-stop agentStop`
2. Sent a peer handoff message (START to the next agent, or ALERT to Hannibal)
**Behavior:** Parses the transcript for both the `agentStop` call and the `SendMessage` handoff. If either is missing, blocks the Stop with an error message explaining what's missing.

**Note:** Terminal agents (Tawnia, Stockwell) use `enforce-completion-log.js` instead — they complete without forwarding to a next agent.

### Pool Management Responses

When agents call `ateam agents-stop agentStop --advance`, the CLI may return special responses:

| Response | Meaning | Agent Action |
|----------|---------|-------------|
| `claimedNext` in JSON | Next agent instance claimed successfully | Send START to `claimedNext` instance, FYI to Hannibal |
| `poolAlert` in JSON | No idle agent instances available | Send ALERT to Hannibal for manual re-dispatch |
| HTTP 409 `WIP_LIMIT_EXCEEDED` | Target stage at capacity | Use `--advance=false` to release claim without advancing, ALERT Hannibal |

### Native Teams Lifecycle Events

In native teams mode, `TeammateIdle` and `TaskCompleted` hooks fire alongside `SubagentStop`:

- **TeammateIdle**: Fires when a teammate is about to go idle. Used by `observe-teammate.js` to track agent lifecycle.
- **TaskCompleted**: Fires when a task completes. Can block to prevent premature completion.

These complement SubagentStart/SubagentStop (which fire in legacy dispatch mode). In native teams mode, prefer TeammateIdle for tracking agent completion.

---

## Sources

- [Claude Code Hooks Reference](https://code.claude.com/docs/en/hooks)
- [Hooks Guide](https://docs.claude.com/en/docs/claude-code/hooks)
- Existing hook scripts in `scripts/hooks/` directory
- Agent frontmatter in `agents/*.md` files

---

## Conclusion

The Claude Code hook system provides **comprehensive lifecycle coverage** with 14 distinct events. For PRD-0005:

1. ✅ **Timing requires manual correlation** via `tool_use_id` and temp files
2. ✅ **PostToolUse provides rich output** (`tool_input` + `tool_response`)
3. ✅ **Permission denials require error string parsing** (no boolean flag)
4. ✅ **SubagentStop is the correct event** for agent completion tracking
5. ✅ **Async hooks enable non-blocking telemetry** for production use

**Next Steps:**
1. Implement minimal telemetry hooks (PostToolUse, PostToolUseFailure, SubagentStop)
2. Create shared timing correlation library
3. Define telemetry output format (JSONL recommended)
4. Test correlation mechanism with real agent runs
