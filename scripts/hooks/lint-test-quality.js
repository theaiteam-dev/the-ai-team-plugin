#!/usr/bin/env node
/**
 * lint-test-quality.js - PreToolUse hook for test quality guardrails
 *
 * Catches egregious test anti-patterns before they get committed:
 *   - No-op assertions like expect(true).toBe(true)
 *   - readFileSync usage in test files (source file regex matching)
 *
 * Targets: murdock, ba (any agent writing to test files)
 * Activates on: Write, Edit tool calls targeting *.test.* or *.spec.* files
 *
 * Claude Code sends hook context via stdin JSON (tool_name, tool_input).
 */

import { readFileSync } from 'fs';

try {
  let hookInput = {};
  try {
    const raw = readFileSync(0, 'utf8');
    hookInput = JSON.parse(raw);
  } catch {
    // Can't read stdin or parse JSON — fail open
    process.exit(0);
  }

  const toolName = hookInput.tool_name || '';

  // Only check Write and Edit tool calls
  if (toolName !== 'Write' && toolName !== 'Edit') {
    process.exit(0);
  }

  const toolInput = hookInput.tool_input || {};
  const filePath = toolInput.file_path || '';

  // Only check test files
  const basename = filePath.split('/').pop() || '';
  if (!basename.match(/\.(test|spec)\./)) {
    process.exit(0);
  }

  // Get the content to check
  // Write uses "content", Edit uses "new_string"
  const content = toolName === 'Write' ? (toolInput.content || '') : (toolInput.new_string || '');

  if (!content) {
    process.exit(0);
  }

  const violations = [];

  // Pattern 1: No-op assertions
  // expect(true).toBe(true), expect(true).toBeTruthy(), expect(false).toBe(false), etc.
  const noopPatterns = [
    /expect\s*\(\s*true\s*\)\s*\.\s*toBe\s*\(\s*true\s*\)/,
    /expect\s*\(\s*true\s*\)\s*\.\s*toBeTruthy\s*\(\s*\)/,
    /expect\s*\(\s*false\s*\)\s*\.\s*toBe\s*\(\s*false\s*\)/,
    /expect\s*\(\s*false\s*\)\s*\.\s*toBeFalsy\s*\(\s*\)/,
    /expect\s*\(\s*1\s*\)\s*\.\s*toBe\s*\(\s*1\s*\)/,
  ];

  for (const pattern of noopPatterns) {
    if (pattern.test(content)) {
      violations.push(
        `No-op assertion detected: "${content.match(pattern)[0]}"\n` +
        '  These assertions always pass and test nothing.\n' +
        '  Instead, assert on actual behavior: call a function, check its return value.'
      );
      break; // One message is enough for this category
    }
  }

  // Pattern 2: readFileSync in test files (source file regex matching anti-pattern)
  if (/readFileSync\s*\(/.test(content)) {
    // Allow readFileSync for fixture/snapshot loading (common legitimate use)
    // But flag it if it looks like reading source files for regex matching
    const lines = content.split('\n');
    for (const line of lines) {
      if (/readFileSync\s*\(/.test(line)) {
        // Skip if it's clearly a fixture or snapshot
        if (/fixture|snapshot|__fixtures__|__snapshots__/i.test(line)) {
          continue;
        }
        violations.push(
          'readFileSync usage detected in test file.\n' +
          '  Tests should import and call production code, not read source files as strings.\n' +
          '  If you need to test file contents, use fixtures instead.\n' +
          '  If this is intentional (e.g., loading test data), ignore this warning.'
        );
        break;
      }
    }
  }

  if (violations.length > 0) {
    process.stderr.write('TEST QUALITY: Anti-pattern detected in test file.\n\n');
    for (const v of violations) {
      process.stderr.write(`  ${v}\n\n`);
    }
    process.stderr.write(`File: ${filePath}\n`);
    process.stderr.write('Write meaningful assertions that test actual behavior.\n');
    process.exit(2);
  }

  // All checks passed
  process.exit(0);
} catch {
  // Fail open on any unexpected error
  process.exit(0);
}
