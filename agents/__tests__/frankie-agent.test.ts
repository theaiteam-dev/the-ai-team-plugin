/**
 * Tests for agents/frankie.md — the mechanical frontmatter contract only
 * (WI-778).
 *
 * SCOPE (deliberately narrow per Sosa's second-pass spec): this file tests
 * only that name/model/description/permissionMode/skills/hooks are present,
 * correctly shaped, and resolve to real files on disk. It does NOT assert
 * on prose sections (Role, Inputs, Process, Hard rules) — frankie.md is
 * markdown consumed by Claude, not compiled/imported code, and a grep-test
 * on prose breaks on every wording edit (banned by the test-writing skill's
 * "Source File Regex Matching" anti-pattern). Those ACs are verified by
 * Lynch reading the file during review.
 *
 * agents/__tests__/observer-hooks-config.test.ts already auto-globs
 * agents/*.md and enrolls frankie.md in three parameterized suites
 * (PreToolUse/PostToolUse/Stop observer-hook presence) — this file does
 * NOT duplicate those. It adds the checks that suite does not make:
 *   - the observer hooks are called with the correct trailing agent-name
 *     argument ("frankie"), not just that the script path appears
 *   - the exact hook composition per section (which non-observer hooks
 *     Frankie carries, and which pipeline-only hooks he must NOT carry,
 *     since he's a once-per-mission terminal agent like Stockwell/Tawnia,
 *     not a pooled pipeline agent)
 *   - name/model/skills scalar and list values
 *   - every referenced hook script and skill file actually exists on disk
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const AGENTS_DIR = join(__dirname, '..');
const REPO_ROOT = join(AGENTS_DIR, '..');
const FRANKIE_PATH = join(AGENTS_DIR, 'frankie.md');

/** Extract the raw frontmatter text between --- delimiters. */
function extractFrontmatter(filePath: string): string | null {
  const content = readFileSync(filePath, 'utf-8');
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  return match ? match[1] : null;
}

/** Extract a top-level scalar frontmatter field, e.g. `name: frankie`. */
function extractScalar(frontmatter: string, key: string): string | null {
  const match = frontmatter.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
  return match ? match[1].trim() : null;
}

/** Extract a top-level `key:\n  - item\n  - item` list, 2-space indented items. */
function extractList(frontmatter: string, key: string): string[] {
  const match = frontmatter.match(new RegExp(`^${key}:\\n((?:  - .+\\n?)*)`, 'm'));
  if (!match) return [];
  return match[1]
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => line.replace(/^\s*-\s*/, '').trim());
}

/**
 * Extract the text of a specific hook section (PreToolUse, PostToolUse, or
 * Stop) from the frontmatter. Copied verbatim from
 * observer-hooks-config.test.ts so both files enforce the identical
 * 2-space-section / 4-space-list-item shape that suite's regex requires.
 */
function extractHookSection(frontmatter: string, sectionName: string): string {
  const sectionRegex = new RegExp(`^  ${sectionName}:\\n((?:(?:    |\\n).*\\n?)*)`, 'm');
  const match = frontmatter.match(sectionRegex);
  if (!match) return '';

  const block = match[1];
  const lines = block.split('\n');
  const result: string[] = [];
  for (const line of lines) {
    if (/^  \S/.test(line)) break;
    result.push(line);
  }
  return result.join('\n');
}

/** Count `command:` lines in a hook section (one per configured hook command). */
function countHookCommands(sectionText: string): number {
  return (sectionText.match(/command:/g) || []).length;
}

describe('agents/frankie.md - mechanical frontmatter contract', () => {
  it('exists and has parseable frontmatter', () => {
    expect(existsSync(FRANKIE_PATH)).toBe(true);
    const frontmatter = extractFrontmatter(FRANKIE_PATH);
    expect(frontmatter).toBeTruthy();
  });

  describe('scalar fields', () => {
    const frontmatter = extractFrontmatter(FRANKIE_PATH)!;

    it("declares name 'frankie'", () => {
      expect(extractScalar(frontmatter, 'name')).toBe('frankie');
    });

    it("declares model 'opus'", () => {
      expect(extractScalar(frontmatter, 'model')).toBe('opus');
    });

    it('declares a non-empty description', () => {
      const description = extractScalar(frontmatter, 'description');
      expect(description).toBeTruthy();
      expect(description!.length).toBeGreaterThan(0);
    });

    it('declares a non-empty permissionMode', () => {
      const permissionMode = extractScalar(frontmatter, 'permissionMode');
      expect(permissionMode).toBeTruthy();
      expect(permissionMode!.length).toBeGreaterThan(0);
    });
  });

  describe('skills list', () => {
    const frontmatter = extractFrontmatter(FRANKIE_PATH)!;
    const skills = extractList(frontmatter, 'skills');

    it('declares exactly the specified skill set', () => {
      expect([...skills].sort()).toEqual(
        ['a11y', 'agent-lifecycle', 'ateam-cli', 'perspective-test', 'teams-messaging'].sort()
      );
    });

    it('does not declare pool-handoff (Frankie is not a pooled pipeline agent)', () => {
      expect(skills).not.toContain('pool-handoff');
    });

    it('every declared skill resolves to a real SKILL.md on disk', () => {
      expect(skills.length).toBeGreaterThan(0);
      for (const skill of skills) {
        const skillPath = join(REPO_ROOT, 'skills', skill, 'SKILL.md');
        expect(existsSync(skillPath), `expected ${skillPath} to exist for skill "${skill}"`).toBe(true);
      }
    });
  });

  describe('hooks - section shape (2-space section keys, 4-space list items, matching agents/amy.md)', () => {
    const frontmatter = extractFrontmatter(FRANKIE_PATH)!;

    it('has PreToolUse, PostToolUse, and Stop sections at 2-space indentation', () => {
      expect(frontmatter).toMatch(/^  PreToolUse:$/m);
      expect(frontmatter).toMatch(/^  PostToolUse:$/m);
      expect(frontmatter).toMatch(/^  Stop:$/m);
    });

    it('has hook list items at 4-space indentation', () => {
      expect(frontmatter).toMatch(/^    - /m);
    });
  });

  describe('hooks - observer hooks carry the correct trailing agent argument', () => {
    const frontmatter = extractFrontmatter(FRANKIE_PATH)!;

    it('PreToolUse observer hook is called with "frankie"', () => {
      const section = extractHookSection(frontmatter, 'PreToolUse');
      expect(section).toMatch(/observe-pre-tool-use\.js frankie"/);
    });

    it('PostToolUse observer hook is called with "frankie"', () => {
      const section = extractHookSection(frontmatter, 'PostToolUse');
      expect(section).toMatch(/observe-post-tool-use\.js frankie"/);
    });

    it('Stop observer hook is called with "frankie"', () => {
      const section = extractHookSection(frontmatter, 'Stop');
      expect(section).toMatch(/observe-stop\.js frankie"/);
    });
  });

  describe('hooks - exact composition per section (the complete final shape)', () => {
    const frontmatter = extractFrontmatter(FRANKIE_PATH)!;

    it('PreToolUse carries block-raw-echo-log.js and the worker board-guard hooks alongside the observer', () => {
      const section = extractHookSection(frontmatter, 'PreToolUse');
      expect(section).toContain('block-raw-echo-log.js');
      expect(section).toContain('block-worker-board-move.js');
      expect(section).toContain('block-worker-board-claim.js');
    });

    it('PostToolUse carries only the observer hook', () => {
      const section = extractHookSection(frontmatter, 'PostToolUse');
      expect(countHookCommands(section)).toBe(1);
      expect(section).toContain('observe-post-tool-use.js');
    });

    it('Stop carries enforce-completion-log.js alongside the observer (terminal agent, not pipeline)', () => {
      const section = extractHookSection(frontmatter, 'Stop');
      expect(section).toContain('enforce-completion-log.js');
    });

    it('Stop does NOT carry enforce-handoff.js (Frankie has no bounce/handoff — done is terminal per adr/0005)', () => {
      const section = extractHookSection(frontmatter, 'Stop');
      expect(section).not.toContain('enforce-handoff.js');
    });
  });

  describe('hooks - referenced scripts resolve to real files on disk', () => {
    const frontmatter = extractFrontmatter(FRANKIE_PATH)!;
    const allHookText = [
      extractHookSection(frontmatter, 'PreToolUse'),
      extractHookSection(frontmatter, 'PostToolUse'),
      extractHookSection(frontmatter, 'Stop'),
    ].join('\n');

    it('every scripts/hooks/*.js referenced in frontmatter exists on disk', () => {
      const scriptRefs = [...allHookText.matchAll(/scripts\/hooks\/([\w-]+\.js)/g)].map((m) => m[1]);
      expect(scriptRefs.length).toBeGreaterThan(0);
      for (const script of scriptRefs) {
        const scriptPath = join(REPO_ROOT, 'scripts', 'hooks', script);
        expect(existsSync(scriptPath), `expected ${scriptPath} to exist`).toBe(true);
      }
    });
  });
});
