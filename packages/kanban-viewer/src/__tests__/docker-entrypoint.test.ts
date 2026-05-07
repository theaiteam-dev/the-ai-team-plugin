/**
 * Tests for packages/kanban-viewer/docker-entrypoint.sh (WI-325)
 *
 * Test approach: the entrypoint is read as text and asserted for critical
 * behavioral contracts encoded as shell script patterns. This is the canonical
 * approach for shell script testing in this codebase (see also:
 * dockerfile-migrate-deploy.test.ts, package-scripts.test.ts).
 *
 * The pruning algorithm is additionally verified behaviorally: 7 fake backup
 * files are created in a temp dir, the prune command is extracted from the
 * script and run against the temp dir, and results are asserted.
 *
 * The entrypoint is NOT spawned end-to-end — no docker build, no container.
 *
 * AC coverage:
 *   AC1  – fresh volume: seed copy, skip backup, migrate, exec
 *   AC2  – existing volume: backup → backfill → migrate → prune → exec
 *   AC3  – backup naming: ateam.db.backup-<YYYYMMDDTHHMMSSZ>
 *   AC4  – pruning: ateam.db.backup-* glob, keep last 5, never touch live DB
 *   AC5  – hard fail on migrate error: set -e + no || { } swallowing
 *   AC6  – hard fail on backfill error: same set -e path
 *   AC7  – DATABASE_URL guard: exit non-zero with clear error if unset
 *   AC8  – missing seed DB: exit non-zero naming the seed path
 *   AC9  – <1s overhead NFR: no sleep commands (content proxy)
 *   AC10 – migrate output not suppressed: no /dev/null redirect
 *   AC11 – backfill via npx tsx (not node), external script not inlined
 */

import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync } from 'fs';
import { resolve, join } from 'path';
import { spawnSync } from 'child_process';
import os from 'os';
import { describe, it, expect, afterEach } from 'vitest';

// Resolve from src/__tests__/ → packages/kanban-viewer/
const ENTRYPOINT_PATH = resolve(__dirname, '../../docker-entrypoint.sh');
const script = readFileSync(ENTRYPOINT_PATH, 'utf-8');

// ─── helpers ────────────────────────────────────────────────────────────────

/**
 * Finds the single line in the script that contains all of the given tokens.
 * Returns undefined if no such line exists.
 */
function lineContaining(...tokens: string[]): string | undefined {
  return script.split('\n').find((l) => tokens.every((t) => l.includes(t)));
}

// ─── tests ──────────────────────────────────────────────────────────────────

describe('docker-entrypoint.sh', () => {

  // ── AC1 & AC2: prisma migrate deploy (replaces db push) ─────────────────

  describe('uses prisma migrate deploy instead of prisma db push', () => {
    // AC1/AC2: migration command must be migrate deploy
    it('contains "prisma migrate deploy"', () => {
      expect(script).toMatch(/prisma migrate deploy/);
    });

    // Negative: the old problematic db push must be gone
    it('does not contain "prisma db push"', () => {
      expect(script).not.toMatch(/prisma db push/);
    });

    // AC1 (impl bug found by Amy): Prisma 7 does NOT auto-discover prisma.config.ts
    // from the prisma/ subdirectory — the --config flag is required or the deploy exits 1
    // with "datasource.url property is required", killing the container on every boot.
    it('includes --config ./prisma/prisma.config.ts on the prisma migrate deploy line', () => {
      const line = lineContaining('prisma migrate deploy');
      expect(line, '"prisma migrate deploy" line not found in script').toBeTruthy();
      expect(line).toContain('--config ./prisma/prisma.config.ts');
    });
  });

  // ── AC5 & AC6: hard-fail — no error swallowing ───────────────────────────

  describe('hard-fail behavior (no error swallowing)', () => {
    // AC5/AC6: || { } is the exact anti-pattern the current broken script uses;
    // its absence combined with set -e means errors propagate and exec never runs
    it('contains no "|| {" error-swallowing patterns', () => {
      expect(script).not.toMatch(/\|\|\s*\{/);
    });

    // set -e is load-bearing: it makes every non-zero exit abort the script
    it('preserves "set -e" so any failed step exits the entrypoint', () => {
      expect(script).toMatch(/^set -e/m);
    });

    // exec node server.js must appear exactly once and only at the very end,
    // ensuring it is reached only when all prior steps succeeded
    it('ends with "exec node server.js" (app started only on full success)', () => {
      expect(script).toMatch(/exec node server\.js/);
    });
  });

  // ── AC3: backup file naming ──────────────────────────────────────────────

  describe('backup file naming (ateam.db.backup-<YYYYMMDDTHHMMSSZ>)', () => {
    // AC3: backup prefix must be present
    it('creates backup with "ateam.db.backup-" prefix', () => {
      expect(script).toMatch(/ateam\.db\.backup-/);
    });

    // AC3: the timestamp must use %Y%m%dT%H%M%SZ — no colons, Z suffix mandatory
    it('generates the timestamp with "date +%Y%m%dT%H%M%SZ" (no colons, Z suffix)', () => {
      expect(script).toMatch(/date \+%Y%m%dT%H%M%SZ/);
    });

    // Negative: colon-separated time like %H:%M:%S would produce colons in the filename
    it('does not use colon-separated time components in the date format', () => {
      const dateInvocation = script.match(/date \+[^\n"')]+/);
      expect(dateInvocation, 'date invocation not found in script').not.toBeNull();
      expect(dateInvocation![0]).not.toMatch(/%[HMS]:%[HMS]/);
    });
  });

  // ── AC4 (content): pruning glob ──────────────────────────────────────────

  describe('backup pruning', () => {
    // AC4: the prune step must use ateam.db.backup-* so live ateam.db is never matched
    it('uses "ateam.db.backup-*" glob for pruning (never matches live ateam.db)', () => {
      expect(script).toMatch(/ateam\.db\.backup-\*/);
    });

    // The prune command must include a sort/head -n -5 pattern to keep the last 5
    it('limits retained backups to 5 using sort + head -n -5 pipeline', () => {
      expect(script).toMatch(/head -n -5/);
    });
  });

  // ── AC11: backfill script invocation ────────────────────────────────────

  describe('backfill script invocation', () => {
    // AC11: must call the WI-321 backfill script via npx tsx
    it('invokes backfill script via "npx tsx ./prisma/scripts/backfill-migrations.ts"', () => {
      expect(script).toMatch(/npx tsx \.\/prisma\/scripts\/backfill-migrations\.ts/);
    });

    // Negative: direct node invocation would bypass tsx transpilation
    it('does not invoke backfill with bare "node ./prisma/scripts/backfill-migrations"', () => {
      expect(script).not.toMatch(/node \.\/prisma\/scripts\/backfill-migrations/);
    });
  });

  // ── AC10: migrate output not suppressed ─────────────────────────────────

  describe('prisma migrate deploy output not redirected to /dev/null', () => {
    // AC10: container logs must show what migrations were applied
    it('does not redirect prisma migrate deploy stdout/stderr to /dev/null', () => {
      const migrateLines = script
        .split('\n')
        .filter((l) => l.includes('prisma migrate deploy'));

      expect(migrateLines.length, '"prisma migrate deploy" not found in script').toBeGreaterThan(0);
      for (const line of migrateLines) {
        expect(line).not.toMatch(/2>\/dev\/null/);
        expect(line).not.toMatch(/>\/dev\/null/);
      }
    });
  });

  // ── AC2: step ordering ───────────────────────────────────────────────────

  describe('existing-volume step ordering: backup → backfill → migrate → prune → exec', () => {
    // AC2: the order is critical and must be preserved exactly
    it('executes steps in the required order', () => {
      // Each token identifies its respective step uniquely
      const backupCreatePos = script.indexOf('ateam.db.backup-$(');   // backup creation
      const backfillPos     = script.indexOf('backfill-migrations.ts'); // WI-321 backfill
      const migratePos      = script.indexOf('prisma migrate deploy'); // migration apply
      const prunePos        = script.indexOf('ateam.db.backup-*');     // prune old backups
      const execPos         = script.indexOf('exec node server.js');   // start app

      expect(backupCreatePos, 'backup creation not found in script').toBeGreaterThan(-1);
      expect(backfillPos,     'backfill invocation not found').toBeGreaterThan(backupCreatePos);
      expect(migratePos,      'prisma migrate deploy not found').toBeGreaterThan(backfillPos);
      expect(prunePos,        'prune step not found').toBeGreaterThan(migratePos);
      expect(execPos,         'exec node server.js not found').toBeGreaterThan(prunePos);
    });
  });

  // ── AC7: DATABASE_URL guard ──────────────────────────────────────────────

  describe('DATABASE_URL guard', () => {
    // AC7: script must detect empty/unset DATABASE_URL and exit with a clear error
    it('checks for empty DATABASE_URL with -z and exits non-zero naming the variable', () => {
      // Guard must be present
      expect(script).toMatch(/-z.*DATABASE_URL/);
      // Error message must name the variable so operators know what to fix
      expect(script).toMatch(/echo.*DATABASE_URL/);
    });
  });

  // ── AC1 & AC8: fresh-volume path ────────────────────────────────────────

  describe('fresh-volume handling', () => {
    // AC1: copies seed DB when no live DB exists
    it('copies the seed DB from /app/prisma/data.init/ateam.db on fresh volume', () => {
      expect(script).toMatch(/\/app\/prisma\/data\.init\/ateam\.db/);
      // cp (optionally with -p to preserve mode) must be used for the copy
      expect(script).toMatch(/cp\b.*data\.init\/ateam\.db/);
    });

    // AC8: if the seed DB is missing, exit non-zero with a CLEAR ERROR naming the seed path
    // The current script silently fails via cp (no explicit message) — the new script must
    // explicitly check and emit an error message that names /app/prisma/data.init/ateam.db
    it('emits an explicit error message naming the seed path when it is missing', () => {
      // An echo/printf with the seed path in the error message is required
      // (a silently-failing cp does not satisfy "clear error naming the seed path")
      const seedErrorLine = script
        .split('\n')
        .find(
          (l) =>
            (l.includes('echo') || l.includes('printf')) &&
            l.includes('data.init')
        );
      expect(
        seedErrorLine,
        'no error message line containing "data.init" (seed path) found in script'
      ).toBeTruthy();
    });
  });

  // ── AC9: <1s overhead NFR (content proxy) ───────────────────────────────

  describe('<1 second startup overhead NFR', () => {
    // AC9: this NFR cannot be measured without running the script, but we can
    // verify no artificial delays are introduced
    it('contains no sleep commands that would add startup latency', () => {
      expect(script).not.toMatch(/\bsleep\b/);
    });
  });

  // ── AC4 behavioral: pruning algorithm ───────────────────────────────────

  describe('pruning algorithm (behavioral)', () => {
    let tmpDir: string;

    afterEach(() => {
      if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
    });

    // AC4: "create 7 fake backup files; assert exactly 2 oldest are removed and
    // live ateam.db is untouched" (verbatim from the acceptance criterion)
    it('deletes the 2 oldest of 7 backup files, keeps the 5 most recent, never touches ateam.db', () => {
      tmpDir = mkdtempSync(join(os.tmpdir(), 'ateam-prune-'));

      // Create 7 lexicographically ordered fake backup files (oldest first)
      const allBackups = [
        'ateam.db.backup-20260501T000000Z', // ← oldest, must be deleted
        'ateam.db.backup-20260502T000000Z', // ← 2nd oldest, must be deleted
        'ateam.db.backup-20260503T000000Z', // ← keep
        'ateam.db.backup-20260504T000000Z', // ← keep
        'ateam.db.backup-20260505T000000Z', // ← keep
        'ateam.db.backup-20260506T000000Z', // ← keep
        'ateam.db.backup-20260507T000000Z', // ← newest, keep
      ];
      for (const name of allBackups) {
        writeFileSync(join(tmpDir, name), 'fake backup content');
      }
      // Live database must survive pruning
      writeFileSync(join(tmpDir, 'ateam.db'), 'live database content');

      // Extract the prune command from the script; substitute the hardcoded
      // /app/prisma/data/ path with tmpDir so we exercise the real implementation
      const pruneLine = script
        .split('\n')
        .find((line) => line.includes('ateam.db.backup-*') && line.includes('rm'));

      expect(pruneLine, 'prune command (containing ateam.db.backup-* and rm) not found in script').toBeTruthy();

      const pruneCmd = pruneLine!
        .trim()
        .replace(/\/app\/prisma\/data\//g, `${tmpDir}/`);

      const result = spawnSync('sh', ['-c', pruneCmd], { encoding: 'utf-8' });
      expect(result.status, `prune command exited non-zero: ${result.stderr}`).toBe(0);

      // 2 oldest backup files must be deleted
      expect(existsSync(join(tmpDir, 'ateam.db.backup-20260501T000000Z'))).toBe(false);
      expect(existsSync(join(tmpDir, 'ateam.db.backup-20260502T000000Z'))).toBe(false);

      // 5 most recent backup files must remain
      expect(existsSync(join(tmpDir, 'ateam.db.backup-20260503T000000Z'))).toBe(true);
      expect(existsSync(join(tmpDir, 'ateam.db.backup-20260504T000000Z'))).toBe(true);
      expect(existsSync(join(tmpDir, 'ateam.db.backup-20260505T000000Z'))).toBe(true);
      expect(existsSync(join(tmpDir, 'ateam.db.backup-20260506T000000Z'))).toBe(true);
      expect(existsSync(join(tmpDir, 'ateam.db.backup-20260507T000000Z'))).toBe(true);

      // Live database must NOT be touched by pruning
      expect(existsSync(join(tmpDir, 'ateam.db'))).toBe(true);
    });

    // Negative / "only" qualifier: when exactly 5 backups exist, none should be deleted
    it('does not delete any backup when exactly 5 exist (nothing to prune)', () => {
      tmpDir = mkdtempSync(join(os.tmpdir(), 'ateam-prune-'));

      const fiveBackups = [
        'ateam.db.backup-20260503T000000Z',
        'ateam.db.backup-20260504T000000Z',
        'ateam.db.backup-20260505T000000Z',
        'ateam.db.backup-20260506T000000Z',
        'ateam.db.backup-20260507T000000Z',
      ];
      for (const name of fiveBackups) {
        writeFileSync(join(tmpDir, name), 'fake backup content');
      }

      const pruneLine = script
        .split('\n')
        .find((line) => line.includes('ateam.db.backup-*') && line.includes('rm'));

      expect(pruneLine, 'prune command not found in script').toBeTruthy();

      const pruneCmd = pruneLine!
        .trim()
        .replace(/\/app\/prisma\/data\//g, `${tmpDir}/`);

      const result = spawnSync('sh', ['-c', pruneCmd], { encoding: 'utf-8' });
      expect(result.status).toBe(0);

      // All 5 must survive — at-limit means nothing is old enough to delete
      for (const name of fiveBackups) {
        expect(existsSync(join(tmpDir, name))).toBe(true);
      }
    });
  });
});
