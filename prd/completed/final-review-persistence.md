---
missionId: ~
---

# Final Review Persistence & Mission Completion

**Author:** Josh  **Date:** 2026-03-30  **Status:** Draft

## Problem Statement

Two gaps in the mission lifecycle:

**1. Stockwell's Final Review is lost.** Stockwell performs a Final Mission Review after all work items reach `done`, producing a holistic codebase review covering cross-cutting issues (consistency, race conditions, security, code quality). This review exists only in Hannibal's conversation context and disappears when the session ends. Stockwell's `agentStop` call fails because there's no work item ID to log against (he tries `FINAL-REVIEW` which doesn't exist).

**2. Hannibal cannot mark a mission as completed.** There is no API endpoint or CLI command to transition a mission from `running` (or `failed`) to `completed`. If Hannibal's session crashes after all work finishes but before the completion sequence runs, the mission is stuck in `failed` state with no way to correct it. This happened on the pass-4 test-harness mission (M-20260330-001) — all 6 items reached `done`, Stockwell approved, Tawnia committed, but the mission record stayed `failed`.

## Goals

1. Stockwell's final review report is persisted in the database and survives session restarts
2. The report is readable via CLI and visible in the Kanban UI
3. The implementation mirrors the existing `retroReport` pattern for consistency

### Success Metrics

- Stockwell can store his report via a single CLI command
- The report is visible in the Mission History panel in the Kanban UI
- Zero changes required to Stockwell's review logic — only the storage/retrieval mechanism is new
- Hannibal can mark a mission completed (or correct a stuck `failed` state) via a single CLI command

## Scope

### In Scope

- New `finalReviewReport` field on the Mission database model
- Prisma migration (ALTER TABLE, not recreate)
- API endpoints: `POST` and `GET` at `/api/missions/[missionId]/final-review`
- Go CLI commands: `ateam missions-review writeReview` and `ateam missions-review getReview`
- `PATCH /api/missions/:missionId` endpoint for updating mission state and `completedAt`
- Go CLI command: `ateam missions-complete completeMission` to mark the current mission as completed
- CLI test coverage
- API test coverage
- UI: display the final review report in the Mission History panel (same placement pattern as retro report)
- OpenAPI spec update
- Update Stockwell's agent prompt to use the new CLI command instead of a fake `agentStop` call
- Update Hannibal's orchestration to call `missions-complete` and the review CLI in the post-mission sequence

### Out of Scope

- Changing Stockwell's review logic or criteria
- Structured/parsed review data (the report is stored as markdown, same as retro)
- Review diffing or comparison across missions
- Any changes to the per-item review process (Lynch)

## Requirements

### Data Model

- **FR1**: The Mission model has a nullable `finalReviewReport` text field that stores markdown
- **FR2**: The field is added via `ALTER TABLE` migration (never replace the live database)

### API

- **FR3**: `POST /api/missions/:missionId/final-review` accepts `{ finalReviewReport: string }` and stores it on the mission record. Requires `X-Project-ID` header. Returns 404 if mission not found.
- **FR4**: `GET /api/missions/:missionId/final-review` returns the stored report. Returns 404 if mission not found. Returns `{ finalReviewReport: null }` if no report has been stored yet.

### CLI

- **FR5**: `ateam missions-review writeReview --body "markdown..."` writes the report to the current mission via POST. Accepts `--body` for inline text or `--body-file` for reading from a file path.
- **FR6**: `ateam missions-review getReview` retrieves and prints the report from the current mission.

### UI

- **FR7**: The Mission History panel displays the final review report when present, using the same rendering approach as the retro report (markdown rendered in a collapsible section)
- **FR8**: When no final review report exists, the section is hidden (not shown as empty)

### Mission Completion

- **FR9**: `PATCH /api/missions/:missionId` accepts `{ state: string, completedAt?: string }` and updates the mission record. Requires `X-Project-ID` header. Returns 404 if mission not found. Only allows transitions to `completed` or `failed` states.
- **FR10**: `ateam missions-complete completeMission` marks the current mission as `completed` with `completedAt` set to now. Works from any state (`running`, `failed`) so it can recover stuck missions.

### Agent Integration

- **FR11**: Stockwell's prompt is updated to call `ateam missions-review writeReview --body "..."` (or `--body-file`) after completing his review, instead of attempting `agentStop` with a fake item ID
- **FR12**: Hannibal's orchestration playbook calls `missions-complete completeMission` after Tawnia commits, and references the review CLI in the post-mission sequence

## Technical Considerations

- **Mirror the retro pattern exactly**: The `retroReport` field, API route (`/api/missions/[missionId]/retro`), CLI commands (`missions-retro writeRetro` / `getRetro`), and UI component (`RetroReport.tsx`) are the template. Follow the same file structure, error handling, and response shapes.
- **SQLite migration**: Use `ALTER TABLE Mission ADD COLUMN finalReviewReport TEXT;` — do not recreate the table or copy data.
- **Report size**: Stockwell's reports can be lengthy (full codebase review). The TEXT column in SQLite has no practical size limit, so no truncation needed.
- **CLI body input**: The `--body-file` flag is important because Stockwell's reports often exceed comfortable inline string length. Read the file contents and POST them.

## Risks & Open Questions

- **Risk**: Stockwell's report may exceed CLI argument length limits if passed inline via `--body`. Mitigation: the `--body-file` flag allows writing to a temp file first, which is the expected primary usage.
- **Risk**: The PATCH endpoint could be misused to set arbitrary states. Mitigation: validate allowed transitions (only `completed` and `failed` are valid target states).
- **Open**: Should the final review report be included in the mission archive JSON export? (Probably yes, for completeness — but can be deferred.)
- **Open**: Should `completeMission` verify all items are in `done` stage before allowing completion, or trust the caller? (Lean toward trust — the recovery use case needs to work even if an item is stuck.)
