/**
 * Tests for WI-323: package.json adds migrate:create script and dev prelude.
 *
 * AC1: scripts['migrate:create'] is exactly 'prisma migrate dev --name'
 *      (npm's -- forwarding appends the migration name, e.g.
 *       `npm run migrate:create -- my-migration` → `prisma migrate dev --name my-migration`)
 * AC2: dev script runs 'prisma migrate deploy' before 'next dev'
 * AC3: dev script is a conditional wrapper (not a bare && chain); on success prisma AND next run
 * AC4: failed migrate deploy → dev exits non-zero; Next.js does NOT start
 * AC5: SKIP_MIGRATE=1 → skips migrate, starts Next.js directly, prints a skip indicator line
 * AC6: SKIP_MIGRATE=1 npm run dev succeeds even when prisma migrate deploy would fail
 *
 * Structural tests (AC1-AC3): read package.json as JSON, assert exact/positional values.
 * Behavioral tests (AC3-AC6): spawn the extracted dev shell script with fake prisma/next
 *   executables on the PATH; marker files prove which processes ran.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync, writeFileSync, mkdtempSync, existsSync, rmSync } from 'fs';
import { resolve, join } from 'path';
import os from 'os';
import { spawnSync } from 'child_process';

// Two levels up from src/__tests__ → packages/kanban-viewer/package.json
const PACKAGE_JSON_PATH = resolve(__dirname, '../../package.json');
const pkg: { scripts: Record<string, string> } = JSON.parse(
  readFileSync(PACKAGE_JSON_PATH, 'utf-8')
);

describe('package.json script entries (WI-323)', () => {
  // ─── Structural: verified by reading package.json as JSON ──────────────────

  describe('migrate:create script', () => {
    // AC1: exact literal value so argument forwarding works correctly
    it('is the exact literal string "prisma migrate dev --config ./prisma/prisma.config.ts --name"', () => {
      expect(pkg.scripts['migrate:create']).toBe(
        'prisma migrate dev --config ./prisma/prisma.config.ts --name'
      );
    });

    // Regression guard: --config must be present so Prisma 7 resolves the custom
    // schema path (prisma.config.ts defines the schema location). Without it,
    // migrate:create fails with "datasource.url property is required".
    it('includes --config ./prisma/prisma.config.ts', () => {
      expect(pkg.scripts['migrate:create']).toContain(
        '--config ./prisma/prisma.config.ts'
      );
    });
  });

  describe('dev script structure', () => {
    // AC2: deploy must appear (and complete) before next dev starts
    it('runs prisma migrate deploy before next dev', () => {
      const devScript = pkg.scripts.dev;
      const deployPos = devScript.indexOf('prisma migrate deploy');
      const nextPos = devScript.indexOf('next dev');
      expect(deployPos).toBeGreaterThanOrEqual(0);
      expect(nextPos).toBeGreaterThanOrEqual(0);
      expect(deployPos).toBeLessThan(nextPos);
    });

    // AC3 (structural): a bare `&& chain` cannot conditionally skip the first step;
    // the SKIP_MIGRATE env-var check requires a wrapper (sh -c if/else, Node script, etc.)
    it('contains SKIP_MIGRATE — is a conditional wrapper, not a bare && chain', () => {
      expect(pkg.scripts.dev).toContain('SKIP_MIGRATE');
    });

    // Regression guard: Prisma 7 + libSQL requires --config on migrate deploy.
    // Without it, migrate deploy exits 1 with "datasource.url property is required"
    // and `npm run dev` fails on every invocation. Same fix as Dockerfile +
    // entrypoint + CI workflow. Must reference prisma.config.ts explicitly.
    it('passes --config prisma.config.ts on the migrate deploy invocation', () => {
      expect(pkg.scripts.dev).toMatch(
        /prisma migrate deploy[^&|]*--config[^&|]*prisma\/prisma\.config\.ts/
      );
    });
  });

  // ─── Behavioral: spawn the dev script with fake prisma / next on PATH ──────
  //
  // Strategy: create a temp dir with shell scripts that:
  //   - fake prisma: writes `prisma.called` marker, exits with a configurable code
  //   - fake next:   writes `next.called`   marker, exits 0 immediately
  // Presence/absence of these markers proves which process was invoked.

  describe('dev script behavior', () => {
    let tmpDir: string;

    function setupFakeCommands(opts: { prismaExitCode?: number } = {}) {
      tmpDir = mkdtempSync(join(os.tmpdir(), 'ateam-pkg-scripts-'));
      const exitCode = opts.prismaExitCode ?? 0;

      writeFileSync(
        join(tmpDir, 'prisma'),
        `#!/bin/sh\ntouch "${join(tmpDir, 'prisma.called')}"\nexit ${exitCode}\n`,
        { mode: 0o755 }
      );
      writeFileSync(
        join(tmpDir, 'next'),
        `#!/bin/sh\ntouch "${join(tmpDir, 'next.called')}"\nexit 0\n`,
        { mode: 0o755 }
      );
    }

    afterEach(() => {
      if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
    });

    // AC3 (happy path): prisma succeeds → both prisma AND next are invoked, exits 0
    it('calls prisma migrate deploy then starts next dev when deploy succeeds', () => {
      setupFakeCommands({ prismaExitCode: 0 });
      const env = { ...process.env, PATH: `${tmpDir}:${process.env.PATH}` } as NodeJS.ProcessEnv;
      delete env.SKIP_MIGRATE;
      const result = spawnSync('sh', ['-c', pkg.scripts.dev], {
        env,
        encoding: 'utf-8',
        timeout: 5000,
      });
      expect(result.status).toBe(0);
      expect(existsSync(join(tmpDir, 'prisma.called'))).toBe(true);
      expect(existsSync(join(tmpDir, 'next.called'))).toBe(true);
      // AC3 "no spurious noise": the wrapper itself must add zero extra output in the
      // normal path (else branch has no echo). If a spurious echo were added to the
      // else branch, this assertion would fail.
      expect(result.stdout).toBe('');
    });

    // AC4: prisma failure propagates — dev exits non-zero and next is NOT started
    it('exits non-zero and does not start next dev when prisma migrate deploy fails', () => {
      setupFakeCommands({ prismaExitCode: 1 });
      const env = { ...process.env, PATH: `${tmpDir}:${process.env.PATH}` } as NodeJS.ProcessEnv;
      delete env.SKIP_MIGRATE;
      const result = spawnSync('sh', ['-c', pkg.scripts.dev], {
        env,
        encoding: 'utf-8',
        timeout: 5000,
      });
      expect(result.status).not.toBe(0);
      expect(existsSync(join(tmpDir, 'next.called'))).toBe(false);
    });

    // AC5 + AC6: SKIP_MIGRATE=1 bypasses prisma (even a failing one) and starts next;
    // the wrapper must also print a line indicating the skip so developers see what happened.
    it('skips migrate, starts next dev, exits 0, and prints a skip indicator when SKIP_MIGRATE=1', () => {
      setupFakeCommands({ prismaExitCode: 1 }); // prisma would fail if called
      const result = spawnSync('sh', ['-c', pkg.scripts.dev], {
        env: {
          ...process.env,
          PATH: `${tmpDir}:${process.env.PATH}`,
          SKIP_MIGRATE: '1',
        },
        encoding: 'utf-8',
        timeout: 5000,
      });
      // AC6: exits 0 even though prisma would fail
      expect(result.status).toBe(0);
      // AC5: prisma was NOT called at all
      expect(existsSync(join(tmpDir, 'prisma.called'))).toBe(false);
      // AC5: next dev WAS started
      expect(existsSync(join(tmpDir, 'next.called'))).toBe(true);
      // AC5: prints one line indicating the skip
      const combinedOutput = (result.stdout ?? '') + (result.stderr ?? '');
      expect(combinedOutput).toMatch(/skip/i);
    });
  });
});
