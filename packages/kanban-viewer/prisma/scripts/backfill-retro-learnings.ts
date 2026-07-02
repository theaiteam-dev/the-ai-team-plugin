/**
 * backfill-retro-learnings.ts
 *
 * Phase 1 validation gate (PRD prd/drafts/mission-learning-loop.md §12):
 * replays the S12 corpus into RetroLearning rows via the capture surface
 * (WI-196), so the recurrence-rank query (WI-198) can be validated against
 * real data before the Debrief goes live.
 *
 * Corpus:
 *  - 5 curated historical missions replaying the four documented repeat
 *    offenders (PRD §1): telemetry-empty (3x), lynch-grep-gaps (5x),
 *    missing-banned-pattern (5x), gitignore-db (2x — filed Low, then
 *    recurred as the #1 Must-Fix). The original retro artifacts predate
 *    structured capture and are not persisted as files in this repo; this
 *    replays their PRD-documented findings against curated mission ids so
 *    match-or-create can be validated to converge each offender onto a
 *    single fingerprint.
 *  - The two stalled drafts (prd/drafts/coderabbit-learnings.md,
 *    prd/drafts/agent-blind-spot-fixes.md) are read from disk and parsed
 *    into rows with missionId: null — this is exactly the "backfill of
 *    stalled drafts" scenario the capture route's null-missionId path
 *    exists for (WI-196): always inserted, never deduped.
 *
 * Everything is captured through the real POST /api/learnings handler
 * in-process (not via prisma.retroLearning.create directly), so dedupe and
 * the project-ownership guard both run for real.
 *
 * Primary usage is programmatic/in-process (this is how the validation test
 * exercises it, and how a Next.js API route or another script would too):
 *   import { backfillRetroLearnings } from './backfill-retro-learnings';
 *   await backfillRetroLearnings({ projectId });
 *
 * A `npx tsx prisma/scripts/backfill-retro-learnings.ts <projectId>` CLI entry
 * point is also provided below, but note: as of this writing, running it
 * standalone via plain `tsx` fails with ERR_PACKAGE_PATH_NOT_EXPORTED, because
 * `@ai-team/shared`'s `exports` field (consumed transitively via
 * `@/app/api/learnings/route` -> `@/lib/errors`) isn't resolvable by tsx's
 * CJS-based loader hook outside of Next.js/Vitest's own module resolution —
 * this is a pre-existing, repo-wide tsx/workspace-package interaction, not
 * specific to this script (reproduces for any file that imports
 * `@ai-team/shared` directly under `npx tsx`). Prefer the programmatic form.
 */

import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import { prisma } from '@/lib/db';
import { POST as captureLearning } from '@/app/api/learnings/route';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../../../..');

export interface BackfillResult {
  rowsCreated: number;
}

interface CaptureInput {
  missionId: string | null;
  source: string;
  severity: string;
  attributedAgent: string;
  targetSurface: string;
  pattern: string;
  fingerprint: string;
  title: string;
  detail: string;
}

// ── Historical missions ──────────────────────────────────────────────────────

interface HistoricalMission {
  id: string;
  name: string;
  startedAt: Date;
}

const HISTORICAL_MISSIONS: HistoricalMission[] = [
  { id: 'M-HIST-2026-001', name: 'Historical retro 1 (2026-05-17)', startedAt: new Date('2026-05-17T00:00:00.000Z') },
  { id: 'M-HIST-2026-002', name: 'Historical retro 2 (2026-05-24)', startedAt: new Date('2026-05-24T00:00:00.000Z') },
  { id: 'M-HIST-2026-003', name: 'Historical retro 3 (2026-06-02)', startedAt: new Date('2026-06-02T00:00:00.000Z') },
  { id: 'M-HIST-2026-004', name: 'Historical retro 4 (2026-06-11)', startedAt: new Date('2026-06-11T00:00:00.000Z') },
  {
    id: 'M-HIST-2026-005',
    name: 'Historical retro 5 (2026-06-20 — gitignore-db recurrence)',
    startedAt: new Date('2026-06-20T00:00:00.000Z'),
  },
];

// The four documented repeat offenders (PRD §1/§12), replayed across curated
// historical missions so recurrence (hits) equals distinct missions.
function buildHistoricalCorpus(): CaptureInput[] {
  const entries: CaptureInput[] = [];

  // telemetry-empty — filed High 3 separate times (PRD §1: "the telemetry-empty
  // item was filed High three separate times").
  for (const missionId of ['M-HIST-2026-001', 'M-HIST-2026-002', 'M-HIST-2026-003']) {
    entries.push({
      missionId,
      source: 'backfill',
      severity: 'high',
      attributedAgent: 'hannibal',
      targetSurface: 'scripts/hooks/lib/observer.js',
      pattern: 'telemetry-empty',
      fingerprint: 'telemetry-empty',
      title: 'Observer telemetry empty for this mission',
      detail:
        'Hook events were not recorded for the mission — activity, token-usage, and tool-histogram data was empty at retro time, degrading the Debrief to a telemetry-only or worse view.',
    });
  }

  // lynch-grep-gaps — 5 distinct missions.
  for (const missionId of [
    'M-HIST-2026-001',
    'M-HIST-2026-002',
    'M-HIST-2026-003',
    'M-HIST-2026-004',
    'M-HIST-2026-005',
  ]) {
    entries.push({
      missionId,
      source: 'backfill',
      severity: 'medium',
      attributedAgent: 'lynch',
      targetSurface: 'agents/lynch.md',
      pattern: 'lynch-grep-gaps',
      fingerprint: 'lynch-grep-gaps',
      title: "Lynch's grep-based review misses renamed or relocated references",
      detail:
        'Lynch grepped for the old identifier or path but missed references that survived under a new name, or in a file the grep pattern did not cover.',
    });
  }

  // missing-banned-pattern — 5 distinct missions.
  for (const missionId of [
    'M-HIST-2026-001',
    'M-HIST-2026-002',
    'M-HIST-2026-003',
    'M-HIST-2026-004',
    'M-HIST-2026-005',
  ]) {
    entries.push({
      missionId,
      source: 'backfill',
      severity: 'medium',
      attributedAgent: 'ba',
      targetSurface: 'skills/defensive-coding/SKILL.md',
      pattern: 'missing-banned-pattern',
      fingerprint: 'missing-banned-pattern',
      title: 'Skill is missing a specific banned-pattern check',
      detail:
        'A skill file states a rule generically but omits the specific anti-pattern instance agents keep reproducing, so the generic wording does not prevent recurrence.',
    });
  }

  // gitignore-db — filed Low first, recurred weeks later as the #1 Must-Fix
  // (PRD §1: "filed Low in the very first local retro (2026-05-17) ...
  // recurred weeks later as the #1 Must-Fix when a 1.1 MB may-prod.db was
  // committed to a feature branch").
  entries.push({
    missionId: 'M-HIST-2026-001',
    source: 'backfill',
    severity: 'low',
    attributedAgent: 'hannibal',
    targetSurface: '.gitignore',
    pattern: 'gitignore-db',
    fingerprint: 'gitignore-db',
    title: 'Add *.db to .gitignore',
    detail: 'SQLite database files are not excluded from version control, risking an accidental commit of local mission data.',
  });
  entries.push({
    missionId: 'M-HIST-2026-005',
    source: 'backfill',
    severity: 'critical',
    attributedAgent: 'hannibal',
    targetSurface: '.gitignore',
    pattern: 'gitignore-db',
    fingerprint: 'gitignore-db',
    title: 'gitignore-db recurred: *.db still not ignored',
    detail:
      'The Low-severity *.db gitignore gap from the first retro was never shipped. A 1.1 MB database file was committed to a feature branch, escalating this to the #1 Must-Fix.',
  });

  return entries;
}

// ── Stalled drafts (parsed from disk, missionId: null) ──────────────────────

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function severityFromHitText(hitText: string): string {
  const match = hitText.match(/(\d+)/);
  const count = match ? parseInt(match[1], 10) : 0;
  if (count >= 10) return 'high';
  if (count >= 4) return 'medium';
  return 'low';
}

function truncate(text: string, maxLength: number): string {
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

/**
 * Parses each `### N.N Title (X hits, Y PRs)` finding category out of
 * prd/drafts/coderabbit-learnings.md into a draft-backfill capture input.
 * These are one-off historical findings, not part of the four curated repeat
 * offenders above, so each gets its own fingerprint.
 */
function parseCoderabbitLearnings(): CaptureInput[] {
  const filePath = path.join(REPO_ROOT, 'prd/drafts/coderabbit-learnings.md');
  const content = readFileSync(filePath, 'utf-8');

  const headerRegex = /^### (\d+\.\d+) (.+?) \(([^)]+)\)$/gm;
  const matches = [...content.matchAll(headerRegex)];
  if (matches.length === 0) {
    throw new Error(`No findings sections parsed from ${filePath} — file structure may have changed`);
  }

  return matches.map((match, i) => {
    const [, number, title, hitText] = match;
    const start = match.index! + match[0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index! : content.length;
    const body = content.slice(start, end);

    const flagsMatch = body.match(/\*\*What CodeRabbit flags:\*\*\s*(.+)/);
    const detail = flagsMatch ? flagsMatch[1].trim() : `CodeRabbit finding: ${title} (${hitText}).`;

    const fixMatch = body.match(/\*\*Fix:\*\*\s*(.+)/);
    const fixFileMatch = fixMatch ? fixMatch[1].match(/`([\w./-]+\.(?:md|ts|tsx|yaml|yml))`/) : null;
    const targetSurface = fixFileMatch ? fixFileMatch[1] : 'CLAUDE.md';

    const slug = slugify(`coderabbit-${number}-${title}`);

    return {
      missionId: null,
      source: 'backfill',
      severity: severityFromHitText(hitText),
      attributedAgent: /test/i.test(title) ? 'murdock' : 'ba',
      targetSurface,
      pattern: slug,
      fingerprint: slug,
      title: `CodeRabbit: ${title}`,
      detail: truncate(detail, 500),
    };
  });
}

/**
 * Parses the four "In Scope" prompt-update bullets out of
 * prd/drafts/agent-blind-spot-fixes.md into draft-backfill capture inputs.
 */
function parseAgentBlindSpotFixes(): CaptureInput[] {
  const filePath = path.join(REPO_ROOT, 'prd/drafts/agent-blind-spot-fixes.md');
  const content = readFileSync(filePath, 'utf-8');

  const bulletRegex = /^- (Murdock|B\.A\.|Lynch|Amy) prompt update: (.+)$/gm;
  const matches = [...content.matchAll(bulletRegex)];
  if (matches.length === 0) {
    throw new Error(`No in-scope prompt-update bullets parsed from ${filePath} — file structure may have changed`);
  }

  const agentSlugs: Record<string, string> = { Murdock: 'murdock', 'B.A.': 'ba', Lynch: 'lynch', Amy: 'amy' };

  return matches.map((match) => {
    const [, agentLabel, rawText] = match;
    const attributedAgent = agentSlugs[agentLabel];
    const detail = rawText.trim();
    const slug = slugify(`${attributedAgent}-blind-spot-${detail.slice(0, 40)}`);

    return {
      missionId: null,
      source: 'backfill',
      severity: 'medium',
      attributedAgent,
      targetSurface: `agents/${attributedAgent}.md`,
      pattern: slug,
      fingerprint: slug,
      title: `${agentLabel} blind spot: prompt needs an explicit check`,
      detail: truncate(detail, 500),
    };
  });
}

// ── Capture + orchestration ──────────────────────────────────────────────────

async function ensureHistoricalMissions(projectId: string): Promise<void> {
  await prisma.project.upsert({
    where: { id: projectId },
    update: {},
    create: { id: projectId, name: projectId },
  });

  for (const mission of HISTORICAL_MISSIONS) {
    await prisma.mission.upsert({
      where: { id: mission.id },
      update: { projectId },
      create: {
        id: mission.id,
        name: mission.name,
        state: 'completed',
        prdPath: 'prd/drafts/mission-learning-loop.md',
        projectId,
        startedAt: mission.startedAt,
        completedAt: mission.startedAt,
      },
    });
  }
}

/** Captures one learning via the real POST /api/learnings handler. Returns true if a new row was created (201), false if an existing row was returned (200, deduped). */
async function capture(projectId: string, entry: CaptureInput): Promise<boolean> {
  const request = new Request('http://localhost:3000/api/learnings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Project-ID': projectId },
    body: JSON.stringify(entry),
  });

  const response = await captureLearning(request);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Capture failed (${response.status}) for fingerprint "${entry.fingerprint}" / mission "${entry.missionId}": ${body}`
    );
  }
  return response.status === 201;
}

export async function backfillRetroLearnings(opts: { projectId: string }): Promise<BackfillResult> {
  const { projectId } = opts;

  await ensureHistoricalMissions(projectId);

  const allEntries: CaptureInput[] = [
    ...buildHistoricalCorpus(),
    ...parseCoderabbitLearnings(),
    ...parseAgentBlindSpotFixes(),
  ];

  let rowsCreated = 0;
  for (const entry of allEntries) {
    const created = await capture(projectId, entry);
    if (created) rowsCreated += 1;
  }

  return { rowsCreated };
}

// Manual CLI usage: npx tsx prisma/scripts/backfill-retro-learnings.ts <projectId>
const isMainModule = process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url;

if (isMainModule) {
  const projectId = process.argv[2];
  if (!projectId) {
    console.error('Usage: npx tsx prisma/scripts/backfill-retro-learnings.ts <projectId>');
    process.exit(1);
  }
  backfillRetroLearnings({ projectId })
    .then(({ rowsCreated }) => {
      console.log(`Backfill complete: ${rowsCreated} RetroLearning rows created for project "${projectId}".`);
      process.exit(0);
    })
    .catch((error) => {
      console.error('Backfill failed:', error);
      process.exit(1);
    });
}
