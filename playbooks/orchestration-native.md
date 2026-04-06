# Orchestration Playbook: Native Teams Mode (Multi-Instance)

> **You are in NATIVE TEAMS mode.** Use `TeamCreate`, `Task` with `team_name`/`name` params, and `SendMessage` for coordination.

This playbook EXTENDS the base native teams orchestration with **stage concurrency**: up to N items can be processed within the same stage simultaneously, each by its own agent instance. N is determined by `ateam scaling compute` (dep graph width × memory budget). When N=1, behaviour is identical to the base playbook (single instance per agent type, no suffixes).

Read `docs/ORCHESTRATION.md` for environment setup, permissions, and dispatch reference.

## API Reference

| Tool | Purpose | Key Parameters |
|------|---------|----------------|
| `TeamCreate` | Create a team for the mission | `team_name`, `description` |
| `Task` | Spawn a teammate agent | `team_name`, `name`, `subagent_type`, `prompt` |
| `SendMessage` | Send messages to teammates | `type`, `recipient`, `content`, `summary` |
| `SendMessage` (broadcast) | Message all teammates | `type: "broadcast"`, `content`, `summary` |
| `SendMessage` (shutdown) | Request teammate shutdown | `type: "shutdown_request"`, `recipient` |
| `TeamDelete` | Clean up team resources | (no params) |

### SendMessage Types

```
# Direct message to a specific teammate
SendMessage(type: "message", recipient: "murdock-1", content: "...", summary: "Brief 5-10 word summary")

# Broadcast to all teammates (use sparingly - expensive)
SendMessage(type: "broadcast", content: "...", summary: "Brief summary")

# Request teammate shutdown
SendMessage(type: "shutdown_request", recipient: "murdock-1", content: "Work complete")

# Approve/reject plan from teammate
SendMessage(type: "plan_approval_response", request_id: "...", recipient: "ba-1", approve: true)
```

## Precheck Flow

Hannibal runs precheck by executing commands and forwarding results to the API — the API does not run commands itself.

```
1. Read ateam.config.json to get check commands
2. Run each command via Bash (capturing stdout, stderr, exit code)
3. Build the result payload:
     passed   = all exit codes were 0
     blockers = human-readable failure messages for each failed check
     output   = { lint: {stdout,stderr,timedOut}, tests: {stdout,stderr,timedOut} }
4. Run: ateam missions-precheck missionPrecheck --passed {passed} --blockers [...] --output {...}
```

### precheck_failure: Recoverable State

`precheck_failure` is a **non-terminal, recoverable** state. It means the checks ran but found problems. The mission is NOT failed — it can be retried.

**When `ateam missions-current getCurrentMission` returns `precheck_failure`:**
- Fetch blockers via `GET /api/missions/current` (REST endpoint) with header `X-Project-ID: <ATEAM_PROJECT_ID>`
- Display blockers to the operator and wait for a retry

**Terminal vs. non-terminal mission states:**
- Non-terminal (recoverable): `initializing`, `prechecking`, `precheck_failure`, `running`, `postchecking`
- Terminal: `completed`, `failed`, `archived`

## Concurrency Detection

At the very start of the mission (before team creation), determine the instance count using a single CLI command:

```bash
# One command computes everything: dep graph analysis + memory budget + adaptive scaling
result=$(ateam scaling compute --json)

# Result contains the full ScalingRationale:
# {
#   "success": true,
#   "data": {
#     "instanceCount": 3,          ← this is N
#     "depGraphMaxPerStage": 3,
#     "memoryBudgetCeiling": 12,
#     "bindingConstraint": "dep_graph",
#     "concurrencyOverride": null
#   }
# }

N = result.data.instanceCount

# Optional: override with manual concurrency (env var or --concurrency flag)
# ateam scaling compute --concurrency 4 --json    # forces N=4, bypasses adaptive math
# ateam scaling compute --memory 8192 --json       # override detected memory (MB)
```

The server queries the current item dependency graph, detects available memory, and returns the recommended instance count. **Hannibal does not need to compute anything manually.**

**Fallback if `ateam scaling compute` is not available** (older CLI version):
```bash
# 1. Get dep graph max: count readyItems from deps-check
deps_result=$(ateam deps-check checkDeps --json)
dep_graph_max = len(deps_result.data.readyItems)    # items that can run in parallel now
if dep_graph_max == 0: dep_graph_max = 1

# 2. Get memory ceiling: free memory / (400 MB per agent × 4 agent types) × 0.8 safety
free_mem_mb=$(free -m | awk '/^Mem:/ {print $7}')
memory_ceiling = floor(free_mem_mb * 0.8 / 400 / 4)
if memory_ceiling < 1: memory_ceiling = 1

# 3. N = min(dep_graph_max, memory_ceiling)
N = min(dep_graph_max, memory_ceiling)
if N < 1: N = 1
```

**Do NOT default to N=1 just because the scaling command failed.** Use the fallback computation above.

After getting the result:
- If N == 1 → single-instance mode (names: murdock, ba, lynch, amy — no suffix)
- If N > 1  → stage concurrency mode (names: murdock-1..N, ba-1..N, etc.) — up to N items processed per stage simultaneously
- Persist the scaling rationale via: `PATCH /api/missions/{missionId}` with `{scalingRationale: result.data}`

> **Single-instance fallback:** When N=1, all instance names are the base names (`murdock`, `ba`, `lynch`, `amy`). `agentStart`/`agentStop` pass these exact names. The instance pool still tracks state, but there is only one entry per agent type.

## Instance Pool Initialization

Build the instance pool before pre-warming:

```
# Each entry: {name, agentType}
instance_pool = []

PIPELINE_AGENTS = ["murdock", "ba", "lynch", "amy"]

for agentType in PIPELINE_AGENTS:
    for i in 1..N:
        name = (N == 1) ? agentType : "{agentType}-{i}"
        instance_pool.append({
            name:          name,
            agentType:     agentType
        })

# active_instances maps item_id → instance name (for Hannibal's tracking only)
active_instances = {}
```

## File-Based Pool Directory

Hannibal creates a pool directory on the local filesystem for zero-latency instance discovery. Agents claim each other directly via atomic `mv` — Hannibal is NOT in the handoff path.

```
POOL_DIR="/tmp/.ateam-pool/${MISSION_ID}"
```

**Directory structure (N=2 example):**
```
/tmp/.ateam-pool/{missionId}/
  murdock-1.idle
  murdock-2.idle
  ba-1.idle
  ba-2.idle
  lynch-1.idle
  lynch-2.idle
  amy-1.idle
  amy-2.idle
```

**Lifecycle:**
- **Mission start:** Hannibal creates the directory upfront, then creates `.idle` files for each lane only after receiving READY messages from all 4 agents in that lane (see Agent Pre-Warming).
- **Agent gets work (agentStart):** Agent `mv`s its own `.idle` → `.busy` (marks itself busy).
- **Agent finishes work (agentStop):** Agent `mv`s its own `.busy` → `.idle` AFTER completing the handoff to the next stage. Do NOT `touch` a new `.idle` — always `mv` the existing `.busy` back, so both files never coexist.
- **Claiming a target:** Sending agent atomically `mv`s a target's `.idle` → `.busy`. On same-filesystem `mv`, only one of two racing agents will succeed — the loser gets ENOENT and retries the next idle file.
- **Mission end:** Tawnia removes the entire pool directory after the final commit (not Hannibal — Tawnia's subagent dispatch guarantees this runs even if Hannibal's session ends early).

**Directory creation (Hannibal, before pre-warming):**
```bash
POOL_DIR="/tmp/.ateam-pool/${MISSION_ID}"
mkdir -p "${POOL_DIR}"
# .idle files are created per-lane after READY confirmation — see Agent Pre-Warming
```

> **CRITICAL: Hannibal MUST NOT touch pool files after initialization.**
> After creating `.idle` files for a lane, Hannibal does not `touch`, `mv`, `rm`, or modify any file in `POOL_DIR`. Only the pipeline agents (Murdock, B.A., Lynch, Amy) manage their own `.idle`/`.busy` state. Hannibal manipulating pool files will contaminate the state and break peer-to-peer handoffs.
>
> **Exception — ALERT recovery only:** If an agent sends an ALERT because the pool is in a bad state (e.g. orphaned `.busy` files from a crashed agent), Hannibal may `ls` the pool directory to diagnose the issue and fix it. This is reactive only — never preemptive. Query first (`ls`), fix only what's broken, then respond to the agent.

## Team Initialization

At mission start, create a team:

```
TeamCreate(team_name: "mission-{missionId}", description: "A(i)-Team mission: {mission name}")
```

## Agent Pre-Warming

Spawn instances **one lane at a time**. Each lane is the complete pipeline quartet for a single concurrency slot: `murdock-N`, `ba-N`, `lynch-N`, `amy-N`. Spawning 4 at once keeps the tmux pane count per window at exactly 4 — the tmux `after-split-window` hook breaks any 5th pane into a new window, so each lane lands in its own tmux window automatically.

**Wait for all 4 agents in a lane to register as `.idle` before spawning the next lane.** This prevents pane creation bursts and ensures the pool directory reflects reality before the next batch starts.

```
# agentType → subagent_type map:
#   murdock → "ai-team:murdock"
#   ba      → "ai-team:ba"
#   lynch   → "ai-team:lynch"
#   amy     → "ai-team:amy"

for lane_number in 1..N:
    lane_instances = instance_pool filtered to lane_number
    # lane_instances = [murdock-N, ba-N, lynch-N, amy-N]

    for instance in lane_instances:
        Task(
            team_name:    "mission-{missionId}",
            name:         instance.name,
            subagent_type: agentTypeToSubagent(instance.agentType),
            description:  "{instance.name}: standby",
            prompt:       "You are {instance.name} ({instance.agentType} instance {lane_number}).
                           Your FIRST action on startup is to send Hannibal a ready signal:
                             SendMessage(to: 'hannibal', content: 'READY: {instance.name}')
                           Then await work item assignments from Hannibal via SendMessage.
                           When receiving work, use exactly '--agent \"{instance.name}\"' in all
                           ateam agents-start and ateam agents-stop commands.
                           After completing work, include your instance name in completion
                           messages: 'DONE: WI-XXX - summary ({instance.name})'."
        )

    # Wait for READY messages from all 4 agents in this lane before continuing.
    # Hannibal then creates their .idle files and proceeds to spawn the next lane.
    wait_for_lane_ready(lane_number)

    # Create .idle files for this lane now that agents are confirmed alive
    for instance in lane_instances:
        touch "${POOL_DIR}/${instance.name}.idle"
```

**`wait_for_lane_ready(lane_number)`**: Block on incoming `SendMessage` until all 4 expected READY messages arrive:

```
lane_agents = {"murdock-{N}", "ba-{N}", "lynch-{N}", "amy-{N}"}
ready = set()

while ready != lane_agents:
    msg = receive next SendMessage
    if msg.content starts with "READY:" and msg.sender in lane_agents:
        ready.add(msg.sender)
```

**Example with N=2:**
```
# Lane 1 — spawn 4 together, wait for all 4 READY messages, create .idle files
Task(team_name: "mission-M1", name: "murdock-1", subagent_type: "ai-team:murdock", ...)
Task(team_name: "mission-M1", name: "ba-1",      subagent_type: "ai-team:ba",      ...)
Task(team_name: "mission-M1", name: "lynch-1",   subagent_type: "ai-team:lynch",   ...)
Task(team_name: "mission-M1", name: "amy-1",     subagent_type: "ai-team:amy",     ...)
# → receive READY from murdock-1, ba-1, lynch-1, amy-1
# → touch murdock-1.idle, ba-1.idle, lynch-1.idle, amy-1.idle

# Lane 2 — spawned only after lane 1 is confirmed alive
Task(team_name: "mission-M1", name: "murdock-2", subagent_type: "ai-team:murdock", ...)
Task(team_name: "mission-M1", name: "ba-2",      subagent_type: "ai-team:ba",      ...)
Task(team_name: "mission-M1", name: "lynch-2",   subagent_type: "ai-team:lynch",   ...)
Task(team_name: "mission-M1", name: "amy-2",     subagent_type: "ai-team:amy",     ...)
# → receive READY from murdock-2, ba-2, lynch-2, amy-2
# → touch murdock-2.idle, ba-2.idle, lynch-2.idle, amy-2.idle
```

Tawnia and Stockwell are NOT pre-warmed (each runs once at mission end — caching won't help).

## Instance Selection

Hannibal uses these helpers for Phase 3 (filling from ready) and resume recovery. Pipeline agents use the file-based pool directory for peer-to-peer handoffs (see "Peer-to-Peer Pool Handoffs" below).

```
function findIdleInstance(agentType):
    # Read pool directory — an .idle file means the instance is available
    # Glob matches both "ba.idle" (N=1) and "ba-1.idle", "ba-2.idle" (N>1)
    idle_files = ls ${POOL_DIR}/${agentType}.idle ${POOL_DIR}/${agentType}-*.idle 2>/dev/null
    if idle_files is empty: return null
    return first match (parse instance name from filename)

function claimInstance(agentType):
    # Atomically claim an idle instance via mv (race-safe)
    # Glob matches both "ba.idle" (N=1) and "ba-1.idle", "ba-2.idle" (N>1)
    for idle_file in ls ${POOL_DIR}/${agentType}.idle ${POOL_DIR}/${agentType}-*.idle 2>/dev/null:
        basename = filename without .idle extension
        result = mv "${idle_file}" "${POOL_DIR}/${basename}.busy" 2>/dev/null
        if result == success:
            return basename   # won the race
        # else: lost race (ENOENT), try next file
    return null  # no idle instance available
```

## The Orchestration Loop

**Check for precheck retry at start of run:**
If mission state is `precheck_failure`:
  - Display blockers to operator
  - Re-run precheck; if passed continue, if failed exit

**Key change from single-instance mode:** Pipeline handoffs (murdock -> ba -> lynch -> amy) are peer-to-peer via the file-based pool directory. Hannibal receives only FYI (success) or ALERT (no idle instance) messages. Hannibal's active role is limited to:
- Phase 2: Unlocking dependency gates
- Phase 3: Filling the pipeline from ready (dispatching to Murdock instances)
- ALERT handling: Queuing items when no idle instance is available

**Hannibal MUST NOT:**
- Touch any file in `POOL_DIR` after initialization (no `touch`, `mv`, `rm` on `.idle`/`.busy` files)
- Pre-claim pool instances for upcoming work
- "Help" by moving pool files to what he thinks is the correct state
- Call `board-move` for items that are in the peer-to-peer pipeline (Murdock → B.A. → Lynch → Amy)

**Hannibal MAY** query pool state (`ls $POOL_DIR`) and fix pool files **only** when an agent explicitly requests help via an ALERT message. Diagnose first, fix only what's broken, then respond to the requesting agent.

**Loop structure:**

```
LOOP CONTINUOUSLY:

    # ═══════════════════════════════════════════════════════════
    # PHASE 1: PROCESS INCOMING MESSAGES (FYI / ALERT / DONE)
    # ═══════════════════════════════════════════════════════════
    # Pipeline agents hand off directly to the next stage's pool.
    # Hannibal receives FYI messages (informational) and ALERT messages
    # (intervention needed). Messages arrive automatically.

    on FYI message from {instanceName}:
        # e.g. "FYI: WI-005 handed to ba-2 (murdock-1)"
        # Informational only — update tracking map
        item_id       = extract WI-XXX from message
        new_instance  = extract target instance name from message
        active_instances[item_id] = new_instance

    on ALERT message from {instanceName}:
        # e.g. "ALERT: No idle ba instance for WI-005 (murdock-1)"
        # No idle instance available — Hannibal must queue and dispatch later
        item_id        = extract WI-XXX from message
        target_type    = extract target agent type from message

        # Queue for dispatch when an instance frees up
        pending_alerts.append({
            item_id:          item_id,
            target_agent_type: target_type,
            alerted_at:       now()
        })

    on DONE message from {instanceName} (probing stage only):
        # Amy instances send DONE directly to Hannibal (no downstream peer handoff)
        item_id = extract WI-XXX from message
        del active_instances[item_id]

        if VERIFIED: Bash("ateam board-move moveItem --itemId {item_id} --toStage done")
        if FLAG:     Bash("ateam items rejectItem --id {item_id}")

        # IMMEDIATELY check dep gates — this item reaching done may unblock others.
        # Do not wait for the next loop iteration. Run deps-check and unlock now.
        deps_result = Bash("ateam deps-check checkDeps --json")
        for dep_item_id in deps_result.readyItems:
            if dep_item is in briefings stage:
                Bash("ateam board-move moveItem --itemId {dep_item_id} --toStage ready")
        # Then fall through to Phase 3 to dispatch newly ready items

    on DONE message from {instanceName} (review stage, REJECTED):
        # Lynch sends DONE-REJECTED directly to Hannibal (rejection needs orchestrator)
        item_id = extract WI-XXX from message
        del active_instances[item_id]
        Bash("ateam items rejectItem --id {item_id}")

    # ═══════════════════════════════════════════════════════════
    # PHASE 1b: DRAIN PENDING ALERTS
    # ═══════════════════════════════════════════════════════════
    # Items that got ALERT (no idle instance) need dispatch when capacity opens.
    for alert in pending_alerts (oldest first):
        claimed = claimInstance(alert.target_agent_type)
        if claimed:
            pending_alerts.remove(alert)
            # NOTE: Do NOT call agentStart here — the dispatched agent owns agentStart as its first action
            dispatch(claimed, alert.item_id)
            active_instances[alert.item_id] = claimed

    # ═══════════════════════════════════════════════════════════
    # PHASE 2: CHECK DEPENDENCY GATES (catch-all)
    # ═══════════════════════════════════════════════════════════
    # Primary dep-check happens inline above (on every DONE message).
    # This is a safety net for edge cases: items unblocked by external
    # changes, missed messages, or first loop iteration at mission start.
    deps_result = Bash("ateam deps-check checkDeps --json")

    for item_id in deps_result.readyItems:
        if item is in briefings stage:
            Bash("ateam board-move moveItem --itemId {item_id} --toStage ready")

    # ═══════════════════════════════════════════════════════════
    # PHASE 3: FILL PIPELINE FROM READY (per-column WIP limits)
    # ═══════════════════════════════════════════════════════════
    # Hannibal dispatches to Murdock instances directly (entry point to pipeline).
    # Subsequent handoffs are peer-to-peer via pool directory.
    while ready stage not empty:
        claimed = claimInstance("murdock")
        if claimed is null: break  # all Murdock instances busy

        item_id = pick next item from ready stage
        result = Bash("ateam agents-start agentStart --itemId {item_id} --agent {claimed}")
        if result is WIP error:
            # Release the claim — put .idle file back
            mv "${POOL_DIR}/${claimed}.busy" "${POOL_DIR}/${claimed}.idle"
            break
        dispatch(claimed, item_id)
        active_instances[item_id] = claimed

    # When finalReviewReady: true → dispatch Stockwell for Final Review
```

## Dispatch Helper

The `dispatch(instance, item_id)` function decides whether to send a `SendMessage` (if instance already alive) or spawn a fresh `Task` (if never spawned or after shutdown):

```
function dispatch(instance, item_id):
    item = Bash("ateam items renderItem --id {item_id}")

    if instance was already spawned and is alive:
        SendMessage(
            type:      "message",
            recipient: instance.name,
            content:   "New work: {item_id} - {title}\n{relevant file paths}\nFetch full details with `ateam items renderItem --id {item_id}`.\nUse '--agent \"{instance.name}\"' in agentStart/agentStop.",
            summary:   "New {instance.agentType} work for {item_id}"
        )
    else:
        Task(
            team_name:    "mission-{missionId}",
            name:         instance.name,
            subagent_type: agentTypeToSubagent(instance.agentType),
            description:  "{instance.name}: {item title}",
            prompt:       "[agent prompt + work item context]
                           Use '--agent \"{instance.name}\"' in agentStart/agentStop.
                           When done, include instance in message: 'DONE: {item_id} - summary ({instance.name})'"
        )
```

## Agent Dispatch Workflows

### Dispatching Murdock (testing stage)

```
# Claim an idle Murdock instance via pool directory, then register claim
claimed = claimInstance("murdock")   # e.g. returns "murdock-2"
ateam agents-start agentStart --itemId 001 --agent murdock-2
active_instances[001] = "murdock-2"
```

**First spawn (or re-spawn):**
```
Task(
  team_name: "mission-{missionId}",
  name: "murdock-2",                          ← instance name, NOT "murdock"
  subagent_type: "ai-team:murdock",
  description: "murdock-2: {feature title}",
  prompt: "... [Murdock prompt from agents/murdock.md]

  Feature Item:
  [Full content of the work item]

  First, register your claim:
  `ateam agents-start agentStart --itemId {itemId} --agent \"murdock-2\"`

  Create the test file at: {outputs.test}
  If outputs.types is specified, also create: {outputs.types}

  STOP after creating these files. Do NOT create {outputs.impl}.

  When done, run `ateam agents-stop agentStop --itemId {itemId} --agent \"murdock-2\" --outcome completed --summary \"...\"`, then notify Hannibal:
  SendMessage(type: 'message', recipient: 'hannibal', content: 'DONE: {itemId} - summary (murdock-2)', summary: 'Tests complete for {itemId}')"
)
```

**Subsequent work (instance already alive):**
```
SendMessage(
  type: "message",
  recipient: "murdock-2",
  content: "New work: WI-005 - {title}\nTest file: {outputs.test}\nTypes file: {outputs.types}\nFetch full details with `ateam items renderItem --id WI-005`.\nFirst run: `ateam agents-start agentStart --itemId WI-005 --agent \"murdock-2\"`",
  summary: "New test work for WI-005"
)
```

### Dispatching B.A. (implementing stage)

Note: In normal pipeline flow, B.A. dispatch happens via peer-to-peer handoff from Murdock (see "Peer-to-Peer Pool Handoffs"). Hannibal dispatches B.A. only for ALERT recovery or resume.

```
claimed = claimInstance("ba")   # e.g. returns "ba-1"
ateam agents-start agentStart --itemId 001 --agent ba-1
active_instances[001] = "ba-1"
```

**First spawn:**
```
Task(
  team_name: "mission-{missionId}",
  name: "ba-1",
  subagent_type: "ai-team:ba",
  description: "ba-1: {feature title}",
  prompt: "... [B.A. prompt]

  Feature Item:
  [Full content of the work item]

  First, register your claim:
  `ateam agents-start agentStart --itemId {itemId} --agent \"ba-1\"`

  Test file is at: {outputs.test}
  Create the implementation at: {outputs.impl}

  When done, run `ateam agents-stop agentStop --itemId {itemId} --agent \"ba-1\" --outcome completed --summary \"...\"`, then notify Hannibal:
  SendMessage(type: 'message', recipient: 'hannibal', content: 'DONE: {itemId} - summary (ba-1)', summary: 'Implementation complete for {itemId}')"
)
```

**On retry (item previously rejected):** Spawn a fresh agent named `ba-1-{id}-r{n}` and include rejection context. Do NOT reuse the existing ba-1 session — it may have stale context.

### Dispatching Lynch (review stage)

Note: In normal pipeline flow, Lynch dispatch happens via peer-to-peer handoff from B.A. Hannibal dispatches Lynch only for ALERT recovery or resume.

```
claimed = claimInstance("lynch")   # e.g. returns "lynch-1"
ateam agents-start agentStart --itemId 001 --agent lynch-1
active_instances[001] = "lynch-1"
```

**First spawn:**
```
Task(
  team_name: "mission-{missionId}",
  name: "lynch-1",
  subagent_type: "ai-team:lynch",
  description: "lynch-1: {feature title}",
  prompt: "... [Lynch prompt]

  Feature Item:
  [Full content of the work item]

  First, register your claim:
  `ateam agents-start agentStart --itemId {itemId} --agent \"lynch-1\"`

  Review ALL these files together:
  - Test: {outputs.test}
  - Implementation: {outputs.impl}
  - Types (if exists): {outputs.types}

  When done, run `ateam agents-stop agentStop --itemId {itemId} --agent \"lynch-1\" --outcome completed --summary \"...\"`, then notify Hannibal:
  SendMessage(type: 'message', recipient: 'hannibal', content: 'DONE: {itemId} - APPROVED/REJECTED - summary (lynch-1)', summary: 'Review complete for {itemId}')"
)
```

### Dispatching Amy (probing stage)

Note: In normal pipeline flow, Amy dispatch happens via peer-to-peer handoff from Lynch. Hannibal dispatches Amy only for ALERT recovery or resume.

```
claimed = claimInstance("amy")   # e.g. returns "amy-2"
ateam agents-start agentStart --itemId 001 --agent amy-2
active_instances[001] = "amy-2"
```

**First spawn:**
```
Task(
  team_name: "mission-{missionId}",
  name: "amy-2",
  subagent_type: "ai-team:amy",
  description: "amy-2: {feature title}",
  prompt: "... [Amy prompt]

  Feature Item:
  [Full content of the work item]

  First, register your claim:
  `ateam agents-start agentStart --itemId {itemId} --agent \"amy-2\"`

  Files to probe:
  - Test: {outputs.test}
  - Implementation: {outputs.impl}
  - Types (if exists): {outputs.types}

  Execute the Raptor Protocol. Respond with VERIFIED or FLAG.

  When done, run `ateam agents-stop agentStop --itemId {itemId} --agent \"amy-2\" --outcome completed --summary \"...\"`, then notify Hannibal:
  SendMessage(type: 'message', recipient: 'hannibal', content: 'DONE: {itemId} - VERIFIED/FLAG - summary (amy-2)', summary: 'Probing complete for {itemId}')"
)
```

### Dispatching Tawnia (documentation)

After post-checks pass (Tawnia is never pre-warmed):

```
Task(
  team_name: "mission-{missionId}",
  name: "tawnia",
  subagent_type: "ai-team:tawnia",
  description: "Tawnia: Documentation and final commit",
  prompt: "... [Tawnia prompt]

  Mission: {mission name}
  Completed items: ...
  Implementation files: ...

  Update documentation and create the final commit.

  When done, run `ateam agents-stop agentStop`, then notify Hannibal:
  SendMessage(type: 'message', recipient: 'hannibal', content: 'DONE: docs - summary with commit hash', summary: 'Documentation and commit complete')"
)
```

## Completion Message Parsing

Teammates include their instance name in completion messages. Parse accordingly:

```
# Message format:
"DONE: WI-003 - Created 5 test cases (murdock-2)"
"DONE: WI-003 - APPROVED - All tests pass (lynch-1)"
"DONE: WI-003 - VERIFIED - All probes pass (amy-1)"
"DONE: WI-003 - FLAG - Race condition found (amy-2)"
"BLOCKED: WI-004 - Missing type definitions (murdock-1)"

# Extract:
item_id      = parse "WI-XXX" from message
instance_name = parse "(murdock-2)" suffix, OR derive from SendMessage sender field
verdict      = parse APPROVED/REJECTED/VERIFIED/FLAG if present
```

The `SendMessage` sender field is the most reliable source of the instance name — use it when the message suffix is absent or ambiguous.

## Minimizing Per-Cycle Token Spend

- Use `ateam deps-check checkDeps --json` in the orchestration loop
- Run `ateam board getBoard --json` only at loop start and after wave completion
- Track state from completion messages between board reads
- With N instances, the pipeline can have up to N×4 items in flight — avoid full board reads every cycle

## Idle State Handling

**Idle is normal.** When an instance's turn ends, the system sends an idle notification. This is NOT an error.

- An instance sending "DONE: WI-001... (murdock-1)" then going idle is the **normal flow**
- Send new work to idle instances with `SendMessage` — they will wake up
- Do NOT re-spawn an instance just because it went idle
- Do NOT treat idle notifications as completion signals for items

**When to re-spawn vs. message:**
- **Message** (preferred): Instance is idle but still alive
- **Re-spawn** (fallback): Instance has shut down or was never spawned

## All-Instances-Busy Handling

**For Hannibal (Phase 3 — filling from ready):**
When `claimInstance("murdock")` returns null (no `.idle` files), stop filling. Items stay in `ready` until a Murdock instance recreates its `.idle` file after completing work.

**For pipeline agents (peer handoffs):**
When `ls ${POOL_DIR}/${NEXT_TYPE}-*.idle` returns no files, the completing agent sends an ALERT to Hannibal. Hannibal queues the item in `pending_alerts` and dispatches when an instance becomes available (Phase 1b).

The board-move WIP limit provides a second safety net — `ateam board-move` will return a WIP error if the target column is already full, regardless of instance availability.

## Peer-to-Peer Pool Handoffs

**Agents hand off directly to the next stage's pool via the filesystem.** Hannibal is NOT in the handoff path. Completing agents claim an idle instance by atomically `mv`-ing its `.idle` file, then send a `START` message directly. Hannibal receives only FYI (success) or ALERT (no idle instance).

### Why File-Based Routing

Production measurements show Hannibal-mediated dispatch adds 2-3 minutes of latency per item (context processing, message round-trip, re-dispatch). With N=2 and 8 items, this overhead eats most of the throughput gain from multi-instance agents. File-based routing eliminates the round-trip entirely:

- **Zero latency** — `ls` + `mv` on local filesystem, no API call, no Hannibal context processing
- **Atomic claiming** — `mv` on the same filesystem is atomic; two agents racing to claim the same instance will have exactly one succeed (the other gets ENOENT)
- **Hannibal only on ALERT** — Hannibal intervenes only when no idle instance is available
- **Invisible to Kanban UI** — pool state is not reflected in the API (acceptable for v1)
- **Ephemeral** — pool directory lives in `/tmp/` and does not survive system restarts (acceptable since missions are ephemeral too)

### Handoff Chain

| Completing agent | Claims from pool | Sends to Hannibal |
|-----------------|------------------|-------------------|
| `murdock-N` done | any idle `ba-M` via `mv` | FYI (success) or ALERT (no idle) |
| `ba-N` done | any idle `lynch-M` via `mv` | FYI (success) or ALERT (no idle) |
| `lynch-N` approved | any idle `amy-M` via `mv` | FYI (success) or ALERT (no idle) |
| `lynch-N` rejected | (no pool claim) | DONE-REJECTED to Hannibal |
| `amy-N` verified/flag | (no downstream agent) | DONE to Hannibal |

**No instance-number affinity.** `murdock-2` completing WI-008 may hand off to `ba-1` or `ba-2` — whichever has an `.idle` file first. The instance numbers of sender and receiver are independent.

### Agent-Side Claiming Flow

Every pipeline agent (except Amy, who has no downstream handoff) executes this flow after `agentStop`:

```bash
# === Run by the completing agent (e.g. murdock-2 finishing WI-005) ===

POOL_DIR="/tmp/.ateam-pool/${MISSION_ID}"
NEXT_TYPE="ba"   # murdock→ba, ba→lynch, lynch→amy

# Step 1: Return own .busy file to .idle (mark self as available for new work)
# MUST use mv — do NOT touch a new .idle file. Both files coexisting = corrupted pool state.
mv "${POOL_DIR}/${MY_INSTANCE_NAME}.busy" "${POOL_DIR}/${MY_INSTANCE_NAME}.idle"

# Step 2: Attempt to claim an idle instance of the next agent type
MAX_RETRIES=3
CLAIMED=""

for attempt in 1..MAX_RETRIES:
    # Glob matches both "ba.idle" (N=1) and "ba-1.idle", "ba-2.idle" (N>1)
    NEXT=$(ls ${POOL_DIR}/${NEXT_TYPE}.idle ${POOL_DIR}/${NEXT_TYPE}-*.idle 2>/dev/null | head -1)
    if [ -z "$NEXT" ]; then
        break   # no idle files at all — skip to ALERT
    fi

    BASENAME=$(basename "$NEXT" .idle)
    mv "$NEXT" "${POOL_DIR}/${BASENAME}.busy" 2>/dev/null
    if [ $? -eq 0 ]; then
        CLAIMED="${BASENAME}"
        break   # won the race
    fi
    # Lost race (ENOENT) — another agent claimed it first. Retry.

if [ -n "$CLAIMED" ]; then
    # === SUCCESS: Send START directly to the claimed instance ===
    SendMessage(
        type: "message",
        recipient: "${CLAIMED}",
        content: "START: WI-005 - {title}\nTest file: {outputs.test}\nImpl file: {outputs.impl}\nFetch details: ateam items renderItem --id WI-005\nFirst run: ateam agents-start agentStart --itemId WI-005 --agent \"${CLAIMED}\"",
        summary: "Handoff WI-005 to ${CLAIMED}"
    )

    # Notify Hannibal (informational only — no action needed)
    SendMessage(
        type: "message",
        recipient: "hannibal",
        content: "FYI: WI-005 handed to ${CLAIMED} (${MY_INSTANCE_NAME})",
        summary: "FYI: WI-005 → ${CLAIMED}"
    )
else
    # === NO IDLE INSTANCE: Alert Hannibal to queue the item ===
    SendMessage(
        type: "message",
        recipient: "hannibal",
        content: "ALERT: No idle ${NEXT_TYPE} instance for WI-005 (${MY_INSTANCE_NAME})",
        summary: "ALERT: No idle ${NEXT_TYPE} for WI-005"
    )
fi
```

**Stage advancement:** The completing agent calls `ateam agents-stop agentStop --advance` which advances the item to the next stage atomically. The `board-move` call is NOT needed in the peer handoff path — `agentStop --advance` handles it.

### Receiving Agent Flow

When a pipeline agent receives a `START` message from a peer (not from Hannibal):

```bash
# === Run by the receiving agent (e.g. ba-2 receiving START for WI-005) ===

# The .idle file was already mv'd to .busy by the sender — no action needed.
# Proceed with normal work:
ateam agents-start agentStart --itemId "WI-005" --agent "${MY_INSTANCE_NAME}"

# ... do work ...

ateam agents-stop agentStop --itemId "WI-005" --agent "${MY_INSTANCE_NAME}" \
    --outcome completed --summary "..."

# Then execute the same claiming flow above to hand off to the NEXT stage.
# (Unless this is Amy — Amy sends DONE directly to Hannibal.)
```

### When All Instances of the Next Type Are Busy

1. The completing agent sends an ALERT to Hannibal (see claiming flow above).
2. Hannibal adds the item to `pending_alerts` (with timestamp).
3. On every Phase 1b cycle, Hannibal checks whether an idle instance is now available via `claimInstance()` and dispatches queued items.
4. The item is **not dropped** — it stays in `pending_alerts` until dispatched.

### Pool File Cleanup

**Mission end:** Hannibal removes the entire pool directory during team shutdown:
```bash
rm -rf "/tmp/.ateam-pool/${MISSION_ID}"
```

**Crash recovery:** On resume, Hannibal recreates the pool directory from scratch (see Resume Recovery). Stale pool directories from crashed missions are harmless — they contain only empty marker files in `/tmp/`.

### Single-Instance Mode (N=1) — Simplified

When `N=1`, instance names have no suffix (`murdock`, `ba`, `lynch`, `amy`). The pool directory still has `.idle` files (`murdock.idle`, `ba.idle`, etc.) and the claiming flow is identical — it just finds at most one file per type. The same code path handles both N=1 and N>1.

## Final Mission Review Dispatch

When ALL items reach `done` stage, fetch `prdPath` from `ateam missions-current getCurrentMission --json`.

**Always spawn a new Stockwell agent** (not pre-warmed, runs once):

```
Task(
  team_name: "mission-{missionId}",
  name: "stockwell",
  subagent_type: "ai-team:stockwell",
  description: "Stockwell: Final Mission Review",
  prompt: "You are Stockwell conducting a FINAL MISSION REVIEW.

  PRD path: {prdPath}

  Review scope: Read the PRD, then run `git diff main...HEAD` to see what
  this mission changed. Review the diff against the PRD requirements.

  Do NOT read the entire codebase. Focus on:
  1. PRD requirements — is each one addressed in the diff?
  2. The mission's commits — correct, consistent, secure?
  3. Integration — do changes wire into the existing codebase?

  When done, run `ateam agents-stop agentStop`, then notify Hannibal:
  SendMessage(type: 'message', recipient: 'hannibal', content: 'DONE: FINAL-REVIEW - FINAL APPROVED/REJECTED - summary', summary: 'Final mission review complete')"
)
```

## Concrete Example: N=2 Multi-Instance Pipeline with File-Based Routing

Setup:
- N=2 concurrency: murdock-1, murdock-2, ba-1, ba-2, lynch-1, lynch-2, amy-1, amy-2
- Wave 0: WI-001, WI-002, WI-003 (no deps)
- Pool directory: `/tmp/.ateam-pool/M1/`

```
T=0s    HANNIBAL:
        mkdir -p /tmp/.ateam-pool/M1/

        Pre-warm lane 1: spawn murdock-1, ba-1, lynch-1, amy-1
        Wait for READY from all 4 → create murdock-1.idle, ba-1.idle, lynch-1.idle, amy-1.idle

        Pre-warm lane 2: spawn murdock-2, ba-2, lynch-2, amy-2
        Wait for READY from all 4 → create murdock-2.idle, ba-2.idle, lynch-2.idle, amy-2.idle

        deps-check → readyItems: [001, 002, 003]
        board-move 001 → ready, board-move 002 → ready, board-move 003 → ready

        Phase 3: fill pipeline (Hannibal dispatches to Murdock — entry point)
          claimInstance("murdock") → mv murdock-1.idle → murdock-1.busy → "murdock-1"
          board-move 001 → testing; dispatch(murdock-1, 001)

          claimInstance("murdock") → mv murdock-2.idle → murdock-2.busy → "murdock-2"
          board-move 002 → testing; dispatch(murdock-2, 002)

          claimInstance("murdock") → null (no .idle files); STOP
          # WI-003 stays in ready; dispatched when a murdock completes

T=30s   MURDOCK-1 finishes WI-001:
        agentStop --advance (WI-001 → implementing)
        mv murdock-1.busy → murdock-1.idle             # mark self idle (mv, NOT touch)
        ls ba-*.idle → ba-1.idle                       # find idle ba
        mv ba-1.idle → ba-1.busy                       # claim ba-1 (atomic)
        SendMessage(to: "ba-1", "START: WI-001...")    # direct peer handoff
        SendMessage(to: "hannibal", "FYI: WI-001 handed to ba-1 (murdock-1)")

        HANNIBAL receives FYI:
        active_instances[001] = "ba-1"

        Phase 3 re-fill:
          claimInstance("murdock") → mv murdock-1.idle → murdock-1.busy → "murdock-1"
          board-move 003 → testing; dispatch(murdock-1, 003)

T=40s   MURDOCK-2 finishes WI-002:
        agentStop --advance (WI-002 → implementing)
        mv murdock-2.busy → murdock-2.idle
        ls ba-*.idle → ba-2.idle
        mv ba-2.idle → ba-2.busy
        SendMessage(to: "ba-2", "START: WI-002...")
        SendMessage(to: "hannibal", "FYI: WI-002 handed to ba-2 (murdock-2)")

T=60s   BA-1 finishes WI-001:
        agentStop --advance (WI-001 → review)
        mv ba-1.busy → ba-1.idle
        ls lynch-*.idle → lynch-1.idle
        mv lynch-1.idle → lynch-1.busy
        SendMessage(to: "lynch-1", "START: WI-001...")
        SendMessage(to: "hannibal", "FYI: WI-001 handed to lynch-1 (ba-1)")

T=65s   MURDOCK-1 finishes WI-003:
        agentStop --advance (WI-003 → implementing)
        mv murdock-1.busy → murdock-1.idle
        ls ba-*.idle → ba-1.idle (ba-1 just freed at T=60s)
        mv ba-1.idle → ba-1.busy
        SendMessage(to: "ba-1", "START: WI-003...")
        SendMessage(to: "hannibal", "FYI: WI-003 handed to ba-1 (murdock-1)")

        ... pipeline continues — all handoffs are peer-to-peer ...
        ... Hannibal only processes FYI messages and fills from ready ...
```

**KEY INSIGHTS:**
1. Two idle Murdock instances → two items enter testing simultaneously (Hannibal dispatches)
2. All subsequent handoffs are peer-to-peer — zero Hannibal latency in the critical path
3. Atomic `mv` prevents double-claiming: two agents racing for `ba-1.idle` — one wins, other retries
4. Hannibal's loop is lightweight: process FYI messages (update tracking), drain alerts, fill from ready
5. Instance names propagate through agentStart/agentStop (murdock-1, ba-2, etc.)

## Team Shutdown

When the mission is complete:

1. **Shutdown all pre-warmed instances:**
```
for instance in instance_pool:
    SendMessage(type: "shutdown_request", recipient: instance.name, content: "Mission complete")
```

2. **Wait for shutdown approvals** (teammates auto-approve unless busy)

3. **Clean up pool directory:**
```bash
rm -rf "/tmp/.ateam-pool/${MISSION_ID}"
```

4. **Delete the team:**
```
TeamDelete()
```

Only send shutdown requests to instances that were actually spawned. Skip any that were never needed.

## Resume Recovery (Native Teams Mode)

Native teams are ephemeral — they don't survive session restarts. On resume:

1. **Log warning:**
   ```
   [Hannibal] Previous team session lost. Re-computing instance pool and spawning fresh teammates.
   ```

2. **Re-determine N** (same concurrency detection logic as mission start)

3. **Create fresh team:**
   ```
   TeamCreate(team_name: "mission-{missionId}", description: "Resumed A(i)-Team mission")
   ```

4. **Re-initialize instance pool** (same structure as before)

5. **Recreate pool directory from scratch:**
   ```bash
   rm -rf "/tmp/.ateam-pool/${MISSION_ID}"
   mkdir -p "/tmp/.ateam-pool/${MISSION_ID}"
   # Create .idle files for ALL instances — agents being re-spawned below
   # will have their files moved to .busy as part of dispatch
   for instance in instance_pool:
       touch "/tmp/.ateam-pool/${MISSION_ID}/${instance.name}.idle"
   ```

6. **Read board state and re-spawn at current stages:**
   ```
   board = Bash("ateam board getBoard --json")
   active_instances = {}

   for item in testing stage:
       Bash("ateam board-release releaseItem --itemId {item_id}")
       claimed = claimInstance("murdock")
       Task(team_name: "mission-{missionId}", name: claimed,
            subagent_type: "ai-team:murdock", ...)
       active_instances[item_id] = claimed

   for item in implementing stage:
       Bash("ateam board-release releaseItem --itemId {item_id}")
       claimed = claimInstance("ba")
       Task(team_name: "mission-{missionId}", name: claimed,
            subagent_type: "ai-team:ba", ...)
       active_instances[item_id] = claimed

   for item in review stage:
       Bash("ateam board-release releaseItem --itemId {item_id}")
       claimed = claimInstance("lynch")
       Task(team_name: "mission-{missionId}", name: claimed,
            subagent_type: "ai-team:lynch", ...)
       active_instances[item_id] = claimed

   for item in probing stage:
       Bash("ateam board-release releaseItem --itemId {item_id}")
       claimed = claimInstance("amy")
       Task(team_name: "mission-{missionId}", name: claimed,
            subagent_type: "ai-team:amy", ...)
       active_instances[item_id] = claimed
   ```

7. **Enter normal orchestration loop** with populated `active_instances`

**API state is the source of truth.** Work items, board positions, and work logs are all preserved in the database. Only the teammate sessions and pool directory are lost — not the work state.
