# /ai-team:status

Check mission progress and current state.

## Usage

```
/ai-team:status
```

## Behavior

1. **Validate mission exists**
   Run `ateam missions-current getCurrentMission --json` to check for active mission.
   ```
   if mission not found:
       error "No mission found. Run /ai-team:plan first."
       exit
   ```

2. **Read board state**
   - Run `ateam board getBoard --json` to get board state
   - Count items in each stage
   - Check current assignments

3. **Display kanban board**

```
═══════════════════════════════════════════════════════════════
                    A(i)-TEAM MISSION STATUS
═══════════════════════════════════════════════════════════════

┌─────────────┬─────────────┬─────────────┬─────────────┬─────────────┐
│  BRIEFINGS  │    READY    │ IN-PROGRESS │   REVIEW    │    DONE     │
├─────────────┼─────────────┼─────────────┼─────────────┼─────────────┤
│ 003-types   │ 010-tests   │ 001-iface   │ 020-impl    │ 002-types   │
│ 004-types   │ 011-tests   │ 012-tests   │             │ 005-iface   │
│             │             │ 021-impl    │             │             │
├─────────────┼─────────────┼─────────────┼─────────────┼─────────────┤
│     2       │     2       │     3       │     1       │     2       │
└─────────────┴─────────────┴─────────────┴─────────────┴─────────────┘

BLOCKED: 0

═══════════════════════════════════════════════════════════════
                      CURRENT ASSIGNMENTS
═══════════════════════════════════════════════════════════════

  B.A.     → 001-iface (Implement user interface types)
  Murdock  → 012-tests (Write auth service tests)
  B.A.     → 021-impl  (Implement user service)
  Lynch    → 020-impl  (Reviewing rate limiter)

═══════════════════════════════════════════════════════════════
                          STATISTICS
═══════════════════════════════════════════════════════════════

  Total Items:     10
  Completed:       2 (20%)
  In Flight:       4
  Blocked:         0

  WIP Limit:       3 / 5 max
  Rejection Rate:  15% (last 10)

  Time Elapsed:    12m 34s

═══════════════════════════════════════════════════════════════
```

4. **Highlight issues**
   - Show blocked items with rejection reasons
   - Flag items with high rejection count
   - Warn about dependency bottlenecks

## Example Output (Blocked Items)

```
═══════════════════════════════════════════════════════════════
                       BLOCKED ITEMS
═══════════════════════════════════════════════════════════════

  ⚠ 015-auth-tests
    Rejected 2 times
    Last feedback: "Tests not covering error cases"
    Use: /ai-team:unblock 015 --guidance "Add network timeout tests"

═══════════════════════════════════════════════════════════════
```

## CLI Commands Used

| Command | Purpose |
|---------|---------|
| `ateam missions-current getCurrentMission --json` | Check mission exists and get metadata |
| `ateam board getBoard --json` | Get full board state with items by stage |
| `ateam items listItems --json` | Get items filtered by stage (optional) |

## Implementation Notes

This is a read-only command that:

1. Runs `ateam board getBoard --json` to get board state
2. Formats ASCII table output
3. Calculates statistics from the response

No agents are launched - this uses the ateam CLI directly.

## Errors

- **No mission found**: Run `/ai-team:plan` first
- **API unavailable**: Cannot connect to A(i)-Team server
