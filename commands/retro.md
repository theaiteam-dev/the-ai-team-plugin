---
model: opus
---
# /ai-team:retro

Generate a retrospective report for the current mission and store it.

## Usage

```
/ai-team:retro
```

## Arguments

None. Operates on the current mission automatically.

## Pre-Flight: Environment Check

```bash
echo $ATEAM_PROJECT_ID
```

```text
if empty or "default":
    Output to user:
    "⚠ ATEAM_PROJECT_ID is not configured.
    Run /ai-team:setup to configure your project, then restart Claude Code."
    STOP.
```

## Behavior

1. **Get mission context**

   ```bash
   ateam missions-current getCurrentMission --json
   ```

   ```text
   if no active mission:
       error "No mission found. Run /ai-team:plan to initialize a mission."
       STOP.
   ```

   Note the `missionId` and `state`. If `state` is not `"completed"`:
   ```text
   Warn user:
   "⚠ Mission is not yet complete (state: {state}). Generating partial retrospective
   based on available data. Some sections may be incomplete."
   Continue — do not stop.
   ```

2. **Dispatch the retro agent**

   Dispatch `agents/retro.md` as a subagent, passing the `missionId`.

   The retro agent will:
   - Pull all mission data from the API
   - Analyze patterns across rejections, Amy flags, Stockwell findings
   - Produce a structured markdown report
   - Store it via `ateam missions-retro writeRetro`

3. **Confirm completion**

   When the retro agent finishes, output:
   ```
   [Retro] Retrospective stored for mission {missionId}.
   View it in the kanban UI or retrieve with:
     ateam missions-retro getRetro --missionId {missionId}
   ```

## CLI Commands Used

| Command | Purpose |
|---------|---------|
| `ateam missions-current getCurrentMission --json` | Get active mission ID and state |
| `ateam missions-retro writeRetro --missionId <id> --report "<markdown>"` | Store the retro report |
| `ateam missions-retro getRetro --missionId <id>` | Retrieve a stored retro report |

## Example

```
/ai-team:retro
```

## Errors

- **No mission found**: Run `/ai-team:plan` first to initialize a mission
- **API unavailable**: Cannot connect to A(i)-Team server
