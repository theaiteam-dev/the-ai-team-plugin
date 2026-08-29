/**
 * Guard: Read-path prompt files must stay under the Read tool's output cap.
 *
 * Claude Code's Read tool truncates a single read at ~25k tokens, returning a
 * PARTIAL view. Any prompt file agents ingest via Read at runtime — playbooks,
 * skill bodies, skill references, docs the playbook points at — silently loses
 * its tail once it outgrows the cap. This is how the native playbook shipped
 * missions where Hannibal never saw the heartbeat, mission-tail, or resume
 * procedures (truncated at line 970 of 1,469; verified 2026-08-29, eval
 * writeup in prd/drafts/slim-hannibal-playbook.md's validation notes).
 *
 * Bytes are a proxy for tokens and density varies (~52KB of prose fits;
 * ~55KB of pseudocode doesn't), so the thresholds carry margin:
 *   WARN  > 40KB — headroom shrinking; plan a split
 *   FAIL  > 48KB — too close to the cap to trust on any content mix
 *
 * Injection-path files (agents/*.md system prompts, commands/*.md slash
 * commands, CLAUDE.md) take a different load path and are deliberately
 * out of scope here.
 *
 * The allowlist is a ratchet: known offenders are tolerated while their
 * tracked fix is in flight, and each entry is asserted to still exceed the
 * FAIL threshold — once a file is fixed, this test forces its removal from
 * the allowlist so it can never silently regrow.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(__dirname, '..', '..');

const WARN_BYTES = 40 * 1024;
const FAIL_BYTES = 48 * 1024;

/**
 * Known offenders with a tracked fix. Remove each entry when its fix lands —
 * the "allowlist entries still breach" test below enforces that.
 */
const ALLOWLIST: Record<string, string> = {
  'playbooks/orchestration-native.md':
    'truncates at ~line 970 — fix tracked by prd/drafts/slim-hannibal-playbook.md (slim core + on-demand sections)',
  'skills/test-writing/SKILL.md':
    'fits under the cap today but has no margin — move newer anti-pattern sections into skills/test-writing/references/',
};

/** Directories whose *.md files agents load via Read at runtime. */
function collectReadPathFiles(): string[] {
  const files: string[] = [];

  const walk = (dir: string) => {
    for (const entry of readdirSync(join(REPO_ROOT, dir), { withFileTypes: true })) {
      const rel = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules') continue;
        walk(rel);
      } else if (entry.name.endsWith('.md')) {
        files.push(rel);
      }
    }
  };

  // Playbooks: loaded whole via Read() per commands/run.md and commands/resume.md.
  walk('playbooks');
  // Skill bodies and their references/: consulted via Read by pipeline agents.
  walk('skills');
  // The one doc the native playbook instructs Hannibal to Read.
  files.push('docs/ORCHESTRATION.md');

  return files;
}

const sizeOf = (rel: string) => statSync(join(REPO_ROOT, rel)).size;
const kb = (bytes: number) => `${(bytes / 1024).toFixed(1)}KB`;

describe('Read-path prompt files stay under the Read tool cap', () => {
  const files = collectReadPathFiles();

  it('discovers the files this guard exists for', () => {
    expect(files).toContain(join('playbooks', 'orchestration-native.md'));
    expect(files).toContain(join('skills', 'test-writing', 'SKILL.md'));
    expect(files.length).toBeGreaterThan(10);
  });

  it(`no un-allowlisted file exceeds ${kb(FAIL_BYTES)}`, () => {
    const candidates = files.filter((f) => !(f in ALLOWLIST));

    const warnings = candidates
      .filter((f) => sizeOf(f) > WARN_BYTES && sizeOf(f) <= FAIL_BYTES)
      .map((f) => `${f} (${kb(sizeOf(f))})`);
    if (warnings.length > 0) {
      // eslint-disable-next-line no-console
      console.warn(
        `[read-path-file-size] approaching the Read cap (warn > ${kb(WARN_BYTES)}, ` +
          `fail > ${kb(FAIL_BYTES)}):\n  ${warnings.join('\n  ')}`,
      );
    }

    const breaches = candidates
      .filter((f) => sizeOf(f) > FAIL_BYTES)
      .map((f) => `${f} (${kb(sizeOf(f))})`);

    expect(
      breaches,
      `These Read-path files are too close to the ~25k-token Read cap and will ` +
        `(or already do) silently truncate when agents load them:\n  ${breaches.join('\n  ')}\n` +
        `Split the file (slim core + on-demand sections, or move detail into references/) ` +
        `rather than raising the threshold.`,
    ).toEqual([]);
  });

  it('allowlist entries still breach (ratchet: remove fixed files)', () => {
    for (const [file, reason] of Object.entries(ALLOWLIST)) {
      expect(
        sizeOf(file),
        `${file} is now under ${kb(FAIL_BYTES)} — its fix landed (${reason}). ` +
          `Remove it from ALLOWLIST so it cannot silently regrow.`,
      ).toBeGreaterThan(FAIL_BYTES);
    }
  });
});
