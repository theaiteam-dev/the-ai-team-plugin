# PRD-010: Commit Provenance — Linking Missions and Work Items to Git Commits

## Overview

Tawnia already injects `WI-XXX` identifiers into commit messages. This PRD closes the loop: record the resulting commit SHA back on the mission and its work items so the kanban history panel becomes a true audit trail — click a mission, see the commit; click a work item, trace it to the exact SHA it shipped in.

## Problem

Mission and work item records in the database have no reference to the git commit that captured their output. The linkage exists only in git log (`git log --grep WI-`), which requires leaving the app. For a tool whose whole job is providing visibility into what the team shipped and why, this is a notable gap.

## Goals

1. Every completed mission records the SHA of Tawnia's final commit.
2. Every work item in that mission records the same SHA (they all land in one commit today; this can be extended if that changes).
3. The mission history panel surfaces the commit SHA with a clickable link to GitHub (if `repoUrl` is configured).
4. The `ateam missions-archive archiveMission` CLI command accepts `--commit-hash` and `--repo-url` flags to record this data at archive time.
5. Tawnia's prompt is updated to run the archive step with the commit SHA after the final commit.

## Non-Goals

- Per-agent-stop commit tracking (only the final Tawnia commit matters for now)
- Parsing git log retroactively to backfill historical missions
- A reverse index (commit → items) — forward links (item → commit) cover the primary use case
- Automated GitHub PR linking

## Schema Changes

### `Mission` model

```prisma
model Mission {
  // ... existing fields ...
  commitHash  String?   // SHA of Tawnia's final commit (e.g. "a1b2c3d")
  repoUrl     String?   // Optional GitHub repo URL for building commit links
                        // e.g. "https://github.com/queso/my-project"
}
```

### `Item` model

```prisma
model Item {
  // ... existing fields ...
  commitHash  String?   // SHA of the commit where this item's work landed
}
```

### Migration

New Prisma migration: `20260321000000_add_commit_provenance`
- Add `commitHash String?` to `Mission`
- Add `repoUrl String?` to `Mission`
- Add `commitHash String?` to `Item`

No data migration required — new nullable columns, existing rows default to `NULL`.

## API Changes

### `POST /api/missions/archive`

Extend the request body to accept optional commit provenance fields:

```typescript
// Request body (all fields optional, existing behavior unchanged when omitted)
{
  commitHash?: string   // Full or short SHA
  repoUrl?: string      // Base GitHub URL, no trailing slash
}
```

The archive handler already runs a transaction to update the mission and archive its items. Extend that transaction to:
1. Set `mission.commitHash` and `mission.repoUrl` if provided
2. Set `commitHash` on all `Item` records linked to this mission via `MissionItem`

```typescript
// In the transaction:
prisma.mission.update({
  where: { id: currentMission.id },
  data: {
    state: 'archived',
    archivedAt: now,
    commitHash: body.commitHash ?? undefined,
    repoUrl: body.repoUrl ?? undefined,
  },
}),
prisma.item.updateMany({
  where: { id: { in: itemIds } },
  data: {
    archivedAt: now,
    commitHash: body.commitHash ?? undefined,
  },
}),
```

### `GET /api/missions` and `GET /api/missions/[missionId]`

Include `commitHash` and `repoUrl` in response payloads. No structural changes — just ensure Prisma select/findMany includes the new fields.

## CLI Changes

### `ateam missions-archive archiveMission`

Add two new optional flags:

```
--commit-hash <sha>   Git commit SHA to record on the mission and its items
--repo-url <url>      Base repository URL (e.g. https://github.com/org/repo)
```

The flags are passed as JSON body to `POST /api/missions/archive`. When omitted, behavior is identical to today.

Example usage by Tawnia:
```bash
COMMIT_SHA=$(git rev-parse HEAD)
ateam missions-archive archiveMission \
  --commit-hash "$COMMIT_SHA" \
  --repo-url "https://github.com/org/repo"
```

The CLI command currently sends `nil` body when no `--body` flag is passed. Update to construct a body from the new flags when they are present, leaving the nil-body path as-is when neither flag is provided.

## Tawnia Prompt Changes (`agents/tawnia.md`)

After the final `git commit`, Tawnia currently calls `ateam missions-archive archiveMission` with no arguments. Update this step:

```
After committing:
1. Capture the commit SHA:
   COMMIT_SHA=$(git rev-parse HEAD)

2. Read repo URL from git remote (optional, best-effort):
   REPO_URL=$(git remote get-url origin 2>/dev/null | sed 's/\.git$//' | sed 's/git@github\.com:/https:\/\/github.com\//' || echo "")

3. Archive with provenance:
   ateam missions-archive archiveMission \
     --commit-hash "$COMMIT_SHA" \
     --repo-url "$REPO_URL"

4. Report to Hannibal:
   [Tawnia] COMMITTED {short_sha} — {commit_message}
```

The `REPO_URL` derivation handles both HTTPS and SSH remote formats. If it fails or returns empty, archive proceeds without `--repo-url` (the flag is optional).

## UI Changes (`MissionHistoryPanel`)

### `ApiMission` type

```typescript
interface ApiMission {
  // ... existing fields ...
  commitHash?: string | null
  repoUrl?: string | null
}
```

### `DetailPane` — Commit section

Add a "Commit" row below the duration field:

```tsx
{mission.commitHash && (
  <div>
    <span className="text-muted-foreground text-xs block">Commit</span>
    {mission.repoUrl ? (
      <a
        href={`${mission.repoUrl}/commit/${mission.commitHash}`}
        target="_blank"
        rel="noopener noreferrer"
        className="font-mono text-xs text-blue-600 hover:underline"
        data-testid="detail-commit-link"
      >
        {mission.commitHash.slice(0, 7)}
      </a>
    ) : (
      <span
        className="font-mono text-xs"
        data-testid="detail-commit-hash"
      >
        {mission.commitHash.slice(0, 7)}
      </span>
    )}
  </div>
)}
```

Shows `a1b2c3d` as a clickable link when `repoUrl` is set, plain monospace text otherwise.

## Work Item Detail (Future / Out of Scope)

The `Item` model now has `commitHash` but the kanban card UI does not currently have a detail/expand view. Surfacing `commitHash` on cards is deferred until a card detail panel is built. The data will be there when that work happens.

## Test Coverage

### New tests required

| File | Tests |
|------|-------|
| `src/__tests__/api/missions/archive-provenance.test.ts` | Archive with commitHash+repoUrl persists on mission and items (3 tests); archive without provenance fields unchanged (1 test); archive with only commitHash (no repoUrl) (1 test) |
| `src/__tests__/mission-history-panel-commit.test.tsx` | Commit link renders when both fields present (1 test); plain hash renders when repoUrl absent (1 test); nothing renders when commitHash null (1 test) |

**Total: ~7 new tests**

### Existing tests

No existing tests should break — all new fields are nullable and the archive route's core behavior (state transition, archivedAt) is unchanged.

## Acceptance Criteria

1. `POST /api/missions/archive` with `{ commitHash: "abc1234", repoUrl: "https://github.com/org/repo" }` sets `commitHash` and `repoUrl` on the mission record and `commitHash` on all linked item records.
2. `POST /api/missions/archive` with no body continues to work exactly as today.
3. `ateam missions-archive archiveMission --commit-hash abc1234 --repo-url https://github.com/org/repo` sends the correct body to the API.
4. Mission history panel `DetailPane` shows a linked SHA (`a1b2c3`) when `commitHash` and `repoUrl` are present.
5. Mission history panel `DetailPane` shows a plain SHA when `commitHash` is present but `repoUrl` is null.
6. Mission history panel `DetailPane` shows nothing in the commit row when `commitHash` is null.
7. Tawnia's prompt drives the archive call with the captured SHA after every successful final commit.
8. The `repoUrl` derivation in Tawnia handles both `git@github.com:org/repo.git` and `https://github.com/org/repo.git` remote formats.

## Rollout Notes

- No migration risk: all new columns are nullable, no existing data is touched.
- Missions completed before this change will show no commit info in the history panel — acceptable, no backfill needed.
- If `git remote get-url origin` fails (local-only repo, no remote), Tawnia skips `--repo-url` and archives with hash only.
