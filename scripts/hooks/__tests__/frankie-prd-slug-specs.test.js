// WI-339: Frankie graduates FlowSpecs under specs/<prd-slug>/.
//
// Two halves:
//   1. block-frankie-writes must allow a brand-new file in a subdirectory of
//      specs/ that did not exist at session start, while still blocking
//      edits/overwrites of existing nested specs and deletion of spec dirs.
//      The hook resolves paths against its own cwd, so each test runs it in a
//      throwaway project directory (never the real repo's specs/).
//   2. agents/frankie.md (a prompt document, so its text IS the behavior)
//      must tell Frankie to derive the slug from the mission's prdPath
//      (basename without extension) and write specs/<prd-slug>/<name>.flow.yaml.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import { randomUUID } from 'crypto';
import { join, resolve } from 'path';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'fs';
import { tmpdir } from 'os';

const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const HOOK = join(REPO_ROOT, 'scripts', 'hooks', 'block-frankie-writes.js');
const FRANKIE_PROMPT = join(REPO_ROOT, 'agents', 'frankie.md');

function runHookIn(cwd, sessionId, toolName, toolInput) {
  try {
    const stdout = execFileSync('node', [HOOK], {
      cwd,
      env: {
        ...process.env,
        ATEAM_API_URL: 'http://localhost:3000',
        ATEAM_PROJECT_ID: 'test-project',
      },
      encoding: 'utf8',
      timeout: 5000,
      input: JSON.stringify({
        agent_type: 'frankie',
        session_id: sessionId,
        tool_name: toolName,
        tool_input: toolInput,
      }),
    });
    return { stdout: stdout.trim(), stderr: '', exitCode: 0 };
  } catch (err) {
    return {
      stdout: (err.stdout || '').trim(),
      stderr: (err.stderr || '').trim(),
      exitCode: err.status ?? 1,
    };
  }
}

describe('block-frankie-writes — nested specs/<prd-slug>/ directories', () => {
  let project;
  let sessionId;

  beforeEach(() => {
    project = mkdtempSync(join(tmpdir(), 'frankie-slug-'));
    sessionId = `frankie-slug-${randomUUID()}`;
    // Pre-existing graduated specs: one flat (staged-column, stays where it
    // is), one nested under a different slug. specs/item-commits/ does NOT
    // exist at session start.
    mkdirSync(join(project, 'specs', 'other-prd'), { recursive: true });
    writeFileSync(join(project, 'specs', 'staged-column.flow.yaml'), 'name: staged\nsteps: []\n');
    writeFileSync(join(project, 'specs', 'other-prd', 'login.flow.yaml'), 'name: login\nsteps: []\n');
  });

  afterEach(() => {
    rmSync(project, { recursive: true, force: true });
  });

  it('allows Write of a new file in a specs/ subdirectory that did not exist at session start', () => {
    const result = runHookIn(project, sessionId, 'Write', {
      file_path: 'specs/item-commits/draft-pr.flow.yaml',
    });
    expect(result.exitCode).toBe(0);
  });

  it('still blocks Edit and overwrite-Write of an existing nested spec, and removal of spec directories', () => {
    // First call takes the session snapshot (specs/item-commits/ absent).
    const first = runHookIn(project, sessionId, 'Write', {
      file_path: 'specs/item-commits/draft-pr.flow.yaml',
    });
    expect(first.exitCode).toBe(0);

    // Frankie then actually creates the new nested spec on disk.
    mkdirSync(join(project, 'specs', 'item-commits'), { recursive: true });
    writeFileSync(join(project, 'specs', 'item-commits', 'draft-pr.flow.yaml'), 'name: draft-pr\nsteps: []\n');

    const edit = runHookIn(project, sessionId, 'Edit', {
      file_path: 'specs/other-prd/login.flow.yaml',
    });
    expect(edit.exitCode).toBe(2);
    expect(edit.stderr).toMatch(/immutable/i);

    const overwrite = runHookIn(project, sessionId, 'Write', {
      file_path: 'specs/other-prd/login.flow.yaml',
    });
    expect(overwrite.exitCode).toBe(2);
    expect(overwrite.stderr).toMatch(/immutable/i);

    // Deleting the slug directory (holds graduated specs) is blocked,
    // both for the pre-existing one and the one created this session.
    for (const dir of ['specs/other-prd', 'specs/item-commits']) {
      const rm = runHookIn(project, sessionId, 'Bash', { command: `rm -rf ${dir}` });
      expect(rm.exitCode).toBe(2);
    }

    // A flat spec outside any slug directory stays protected too.
    const flat = runHookIn(project, sessionId, 'Edit', {
      file_path: 'specs/staged-column.flow.yaml',
    });
    expect(flat.exitCode).toBe(2);
  });

  it('does not let a new file in one slug directory unlock an existing file in another', () => {
    // Snapshot first, then ask about an existing spec in a sibling slug dir
    // while a brand-new slug dir is allowed.
    expect(
      runHookIn(project, sessionId, 'Write', { file_path: 'specs/item-commits/new.flow.yaml' }).exitCode,
    ).toBe(0);
    expect(
      runHookIn(project, sessionId, 'Write', { file_path: 'specs/other-prd/login.flow.yaml' }).exitCode,
    ).toBe(2);
  });
});

describe('agents/frankie.md — spec graduation path', () => {
  // The prompt is the implementation here; its text is what Frankie follows.
  const prompt = readFileSync(FRANKIE_PROMPT, 'utf8');

  it('tells Frankie to write graduated specs to specs/<prd-slug>/<name>.flow.yaml', () => {
    expect(prompt).toContain('specs/<prd-slug>/<name>.flow.yaml');
    // The old flat path must no longer be the instruction.
    expect(prompt).not.toContain('`specs/<name>.flow.yaml`');
    expect(prompt).not.toContain('flowspec run specs/<name>.flow.yaml');
  });

  it('defines the slug as the mission prdPath filename without extension', () => {
    expect(prompt).toMatch(/prdPath/);
    expect(prompt).toMatch(/<prd-slug>[^\n]*(without|minus|sans)[^\n]*extension|(without|minus|sans)[^\n]*extension[^\n]*<prd-slug>|slug[^\n]*(without|minus|sans)[^\n]*extension/i);
  });

  it('tells Frankie to report the graduated spec paths in his DONE message', () => {
    expect(prompt).toMatch(/DONE[\s\S]{0,400}graduated[\s\S]{0,200}(path|specs\/<prd-slug>)/i);
  });
});
