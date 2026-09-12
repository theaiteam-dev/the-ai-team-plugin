/**
 * Tests for agents/pike.md — the mechanical frontmatter contract, plus a
 * small set of durable body-boundary assertions.
 *
 * SCOPE: modelled directly on agents/__tests__/frankie-agent.test.ts. This
 * file asserts that name/model/description/skills/hooks are present,
 * correctly shaped, and resolve to real files on disk. It deliberately does
 * NOT grep Pike's prose sections line by line — pike.md is markdown consumed
 * by Claude, not compiled code, and a regex over prose breaks on every
 * wording edit (the test-writing skill's "Source File Regex Matching"
 * anti-pattern). The handful of body assertions below are restricted to the
 * five boundaries that define the agent's existence (never write impl, never
 * write a failing test, never create the mission, never touch the board, and
 * the cause is suspected rather than authoritative). Those are the rules a
 * future edit must not silently drop; everything else is Lynch's job on read.
 *
 * agents/__tests__/observer-hooks-config.test.ts already auto-globs
 * agents/*.md and enrolls pike.md in three parameterized suites
 * (PreToolUse/PostToolUse/Stop observer-hook presence) — this file does NOT
 * duplicate those. It adds the checks that suite does not make:
 *   - the observer hooks are called with the correct trailing agent-name
 *     argument ("pike"), not just that the script path appears
 *   - the exact hook composition per section (the block-pike-writes.js guard
 *     with its Write|Edit matcher, and the item-scoped pipeline hooks Pike
 *     must NOT carry — he runs before any mission exists and claims nothing)
 *   - name/model/description/skills scalar and list values
 *   - every referenced hook script and skill file actually exists on disk
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const AGENTS_DIR = join(__dirname, '..');
const REPO_ROOT = join(AGENTS_DIR, '..');
const PIKE_PATH = join(AGENTS_DIR, 'pike.md');

/** Extract the raw frontmatter text between --- delimiters. */
function extractFrontmatter(filePath: string): string | null {
  const content = readFileSync(filePath, 'utf-8');
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  return match ? match[1] : null;
}

/** Everything after the closing frontmatter delimiter. */
function extractBody(filePath: string): string {
  const content = readFileSync(filePath, 'utf-8');
  const match = content.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/);
  return match ? match[1] : '';
}

/** Extract a top-level scalar frontmatter field, e.g. `name: pike`. */
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
 * observer-hooks-config.test.ts (via frankie-agent.test.ts) so every agent
 * file enforces the identical 2-space-section / 4-space-list-item shape that
 * suite's regex requires.
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

describe('agents/pike.md - mechanical frontmatter contract', () => {
  it('exists and has parseable frontmatter', () => {
    expect(existsSync(PIKE_PATH)).toBe(true);
    const frontmatter = extractFrontmatter(PIKE_PATH);
    expect(frontmatter).toBeTruthy();
  });

  describe('scalar fields', () => {
    const frontmatter = extractFrontmatter(PIKE_PATH)!;

    it("declares name 'pike'", () => {
      expect(extractScalar(frontmatter, 'name')).toBe('pike');
    });

    it("declares model 'opus'", () => {
      expect(extractScalar(frontmatter, 'model')).toBe('opus');
    });

    it('declares a non-empty description', () => {
      const description = extractScalar(frontmatter, 'description');
      expect(description).toBeTruthy();
      expect(description!.length).toBeGreaterThan(0);
    });

    it('description names the triage role', () => {
      const description = extractScalar(frontmatter, 'description')!;
      expect(description).toMatch(/triage/i);
    });

    it('description names the work-item deliverable', () => {
      const description = extractScalar(frontmatter, 'description')!;
      expect(description).toMatch(/work item/i);
    });

    it('description states the never-writes-code boundary', () => {
      const description = extractScalar(frontmatter, 'description')!;
      expect(description).toMatch(/never writes? code/i);
    });
  });

  describe('skills list', () => {
    const frontmatter = extractFrontmatter(PIKE_PATH)!;
    const skills = extractList(frontmatter, 'skills');

    it('declares exactly the specified skill set', () => {
      expect([...skills].sort()).toEqual(
        ['ateam-cli', 'mission-brief', 'perspective-test', 'work-breakdown'].sort()
      );
    });

    it('does not declare pool-handoff (Pike is not a pooled pipeline agent)', () => {
      expect(skills).not.toContain('pool-handoff');
    });

    it('does not declare agent-lifecycle (Pike never runs agentStart/agentStop)', () => {
      expect(skills).not.toContain('agent-lifecycle');
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
    const frontmatter = extractFrontmatter(PIKE_PATH)!;

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
    const frontmatter = extractFrontmatter(PIKE_PATH)!;

    it('PreToolUse observer hook is called with "pike"', () => {
      const section = extractHookSection(frontmatter, 'PreToolUse');
      expect(section).toMatch(/observe-pre-tool-use\.js pike"/);
    });

    it('PostToolUse observer hook is called with "pike"', () => {
      const section = extractHookSection(frontmatter, 'PostToolUse');
      expect(section).toMatch(/observe-post-tool-use\.js pike"/);
    });

    it('Stop observer hook is called with "pike"', () => {
      const section = extractHookSection(frontmatter, 'Stop');
      expect(section).toMatch(/observe-stop\.js pike"/);
    });
  });

  describe('hooks - exact composition per section (the complete final shape)', () => {
    const frontmatter = extractFrontmatter(PIKE_PATH)!;

    it('PreToolUse carries exactly two hooks: the write guard and the observer', () => {
      const section = extractHookSection(frontmatter, 'PreToolUse');
      expect(countHookCommands(section)).toBe(2);
      expect(section).toContain('block-pike-writes.js');
      expect(section).toContain('observe-pre-tool-use.js');
    });

    it('block-pike-writes.js is registered under a "Write|Edit" matcher', () => {
      const section = extractHookSection(frontmatter, 'PreToolUse');
      expect(section).toMatch(
        /- matcher: "Write\|Edit"\n\s+hooks:\n\s+- type: command\n\s+command: "[^"]*block-pike-writes\.js"/
      );
    });

    it('PostToolUse carries only the observer hook', () => {
      const section = extractHookSection(frontmatter, 'PostToolUse');
      expect(countHookCommands(section)).toBe(1);
      expect(section).toContain('observe-post-tool-use.js');
    });

    it('Stop carries only the observer hook', () => {
      const section = extractHookSection(frontmatter, 'Stop');
      expect(countHookCommands(section)).toBe(1);
      expect(section).toContain('observe-stop.js');
    });

    // enforce-completion-log.js and enforce-handoff.js are ITEM-scoped: they
    // scrape a WI-XXX id out of the agent's last message and read that item's
    // work_log / next claim. Pike runs BEFORE any mission exists, claims
    // nothing (agentStart/agentStop are explicitly not his), and leaves every
    // item he files sitting in `briefings` with no assigned agent — so there
    // is no claim for either hook to authenticate against. Worse than inert:
    // his Phase Two result block REQUIRES him to list the WI-XXX ids he
    // created, so /WI-(\d+)/ would latch onto a real item and block him for
    // not logging completion against work he never claimed.
    it('Stop does NOT carry enforce-completion-log.js (item-scoped hook, pre-mission agent)', () => {
      const section = extractHookSection(frontmatter, 'Stop');
      expect(section).not.toContain('enforce-completion-log.js');
    });

    it('Stop does NOT carry enforce-handoff.js (Pike hands off to no pipeline agent)', () => {
      const section = extractHookSection(frontmatter, 'Stop');
      expect(section).not.toContain('enforce-handoff.js');
    });
  });

  describe('hooks - referenced scripts resolve to real files on disk', () => {
    const frontmatter = extractFrontmatter(PIKE_PATH)!;
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

describe('agents/pike.md - body boundary contract', () => {
  const body = extractBody(PIKE_PATH);

  it('has a body after the frontmatter', () => {
    expect(body.length).toBeGreaterThan(0);
  });

  it('states that Pike never writes implementation code', () => {
    expect(body).toMatch(/never write implementation code/i);
  });

  it('states that Pike never writes a failing test', () => {
    expect(body).toMatch(/never write a failing test/i);
  });

  it('names Murdock as the agent who writes the test instead', () => {
    expect(body).toMatch(/never write a failing test[\s\S]{0,800}Murdock/i);
  });

  it('states that Pike never creates the mission', () => {
    expect(body).toMatch(/never create the mission/i);
  });

  it('states that Pike never moves or claims a board item', () => {
    expect(body).toMatch(/never move[^\n]*board item/i);
  });

  it('states the suspected cause is suspected rather than authoritative', () => {
    expect(body).toMatch(/suspected,? not authoritative/i);
  });
});
