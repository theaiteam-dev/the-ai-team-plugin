/**
 * Tests for observer hook configuration in agent markdown files.
 *
 * Verifies that all agent files have observer hooks properly configured
 * alongside existing enforcement hooks.
 *
 * Uses regex matching on frontmatter text instead of full YAML parsing,
 * since we only need to verify that specific hook script filenames appear
 * in the correct hook sections.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const AGENTS_DIR = join(__dirname, '..');
const OBSERVER_SCRIPTS = {
  preToolUse: 'scripts/hooks/observe-pre-tool-use.js',
  postToolUse: 'scripts/hooks/observe-post-tool-use.js',
  stop: 'scripts/hooks/observe-stop.js',
};

/**
 * Extract the raw frontmatter text between --- delimiters.
 */
function extractFrontmatter(filePath: string): string | null {
  const content = readFileSync(filePath, 'utf-8');
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  return match ? match[1] : null;
}

/**
 * Extract the text of a specific hook section (PreToolUse, PostToolUse, or Stop)
 * from the frontmatter. Returns the full text block for that section.
 */
function extractHookSection(frontmatter: string, sectionName: string): string {
  // Match from the section header to the next sibling section or end of hooks
  const sectionRegex = new RegExp(
    `^  ${sectionName}:\\n((?:(?:    |\\n).*\\n?)*)`,
    'm'
  );
  const match = frontmatter.match(sectionRegex);
  if (!match) return '';

  // Trim at the next sibling-level key (2-space indent, non-dash)
  const block = match[1];
  const lines = block.split('\n');
  const result: string[] = [];
  for (const line of lines) {
    // Stop at next hook section (e.g. "  PostToolUse:" or "  Stop:")
    if (/^  \S/.test(line)) break;
    result.push(line);
  }
  return result.join('\n');
}

/**
 * Check if a hook section contains a command referencing the given script path.
 */
function sectionContainsScript(sectionText: string, scriptPath: string): boolean {
  return sectionText.includes(scriptPath);
}

/**
 * Check if a hook section has a specific matcher block containing a given script.
 * A matcher block starts with `- matcher: "X"` and the script appears in subsequent lines.
 * For catch-all hooks (no matcher), the block starts with just `- hooks:`.
 */
function sectionHasMatcherWithScript(
  sectionText: string,
  matcher: string | null,
  scriptPath: string
): boolean {
  const blocks = sectionText.split(/^    - /m).filter(Boolean);

  for (const block of blocks) {
    const hasMatcher = matcher
      ? block.includes(`matcher: "${matcher}"`)
      : !block.includes('matcher:');

    if (hasMatcher && block.includes(scriptPath)) {
      return true;
    }
  }
  return false;
}

/**
 * Get all agent markdown files
 */
function getAgentFiles(): string[] {
  return readdirSync(AGENTS_DIR)
    .filter(file => file.endsWith('.md') && !file.startsWith('AGENTS'))
    .map(file => join(AGENTS_DIR, file));
}

describe('Observer Hooks Configuration', () => {
  const agentFiles = getAgentFiles();

  it('should find agent markdown files', () => {
    expect(agentFiles.length).toBeGreaterThan(0);
  });

  describe('PreToolUse observer hooks', () => {
    agentFiles.forEach(filePath => {
      const fileName = filePath.split('/').pop();

      it(`${fileName} should have PreToolUse observer hook`, () => {
        const frontmatter = extractFrontmatter(filePath);
        expect(frontmatter).toBeTruthy();

        const section = extractHookSection(frontmatter!, 'PreToolUse');
        expect(section).toBeTruthy();

        // The observer hook should be in a catch-all block (no matcher)
        expect(
          sectionContainsScript(section, OBSERVER_SCRIPTS.preToolUse)
        ).toBe(true);
      });
    });
  });

  describe('PostToolUse observer hooks', () => {
    agentFiles.forEach(filePath => {
      const fileName = filePath.split('/').pop();

      it(`${fileName} should have PostToolUse observer hook`, () => {
        const frontmatter = extractFrontmatter(filePath);
        expect(frontmatter).toBeTruthy();

        const section = extractHookSection(frontmatter!, 'PostToolUse');
        expect(section).toBeTruthy();

        expect(
          sectionContainsScript(section, OBSERVER_SCRIPTS.postToolUse)
        ).toBe(true);
      });
    });
  });

  describe('Stop observer hooks', () => {
    agentFiles.forEach(filePath => {
      const fileName = filePath.split('/').pop();

      it(`${fileName} should have Stop observer hook`, () => {
        const frontmatter = extractFrontmatter(filePath);
        expect(frontmatter).toBeTruthy();

        const section = extractHookSection(frontmatter!, 'Stop');
        expect(section).toBeTruthy();

        expect(
          sectionContainsScript(section, OBSERVER_SCRIPTS.stop)
        ).toBe(true);
      });
    });
  });

  describe('Enforcement hooks preservation', () => {
    it('hannibal.md should retain block-hannibal-writes.js hook', () => {
      const frontmatter = extractFrontmatter(join(AGENTS_DIR, 'hannibal.md'));
      const section = extractHookSection(frontmatter!, 'PreToolUse');

      expect(
        sectionHasMatcherWithScript(section, 'Write|Edit', 'block-hannibal-writes.js')
      ).toBe(true);
    });

    it('hannibal.md should retain block-raw-mv.js hook', () => {
      const frontmatter = extractFrontmatter(join(AGENTS_DIR, 'hannibal.md'));
      const section = extractHookSection(frontmatter!, 'PreToolUse');

      expect(
        sectionHasMatcherWithScript(section, 'Bash', 'block-raw-mv.js')
      ).toBe(true);
    });

    it('hannibal.md should retain enforce-final-review.js hook', () => {
      const frontmatter = extractFrontmatter(join(AGENTS_DIR, 'hannibal.md'));
      const section = extractHookSection(frontmatter!, 'Stop');

      expect(sectionContainsScript(section, 'enforce-final-review.js')).toBe(true);
    });

    it('working agents should retain block-raw-echo-log.js hook', () => {
      const workingAgents = ['murdock.md', 'ba.md', 'lynch.md', 'amy.md', 'tawnia.md'];

      workingAgents.forEach(agentFile => {
        const frontmatter = extractFrontmatter(join(AGENTS_DIR, agentFile));
        const section = extractHookSection(frontmatter!, 'PreToolUse');

        expect(
          sectionHasMatcherWithScript(section, 'Bash', 'block-raw-echo-log.js'),
          `${agentFile} should have block-raw-echo-log.js in Bash matcher`
        ).toBe(true);
      });
    });

    it('working agents should retain enforce-completion-log.js hook', () => {
      const workingAgents = ['murdock.md', 'ba.md', 'lynch.md', 'amy.md', 'tawnia.md'];

      workingAgents.forEach(agentFile => {
        const frontmatter = extractFrontmatter(join(AGENTS_DIR, agentFile));
        const section = extractHookSection(frontmatter!, 'Stop');

        expect(
          sectionContainsScript(section, 'enforce-completion-log.js'),
          `${agentFile} should have enforce-completion-log.js`
        ).toBe(true);
      });
    });

    it('amy.md should retain block-amy-test-writes.js hook', () => {
      const frontmatter = extractFrontmatter(join(AGENTS_DIR, 'amy.md'));
      const section = extractHookSection(frontmatter!, 'PreToolUse');

      expect(
        sectionHasMatcherWithScript(section, 'Write|Edit', 'block-amy-test-writes.js')
      ).toBe(true);
    });
  });
});
