// WI-343: QA sandbox script for the item-commits mission.
//
// Smoke tests only (task item). The full happy path needs the dev:qa API on
// :5567 and a Go toolchain, so Frankie exercises it; here we pin what can be
// checked hermetically: the contract declares the cli surface, the script
// exists and parses, never targets the user's/plugin's real ateam binary, and
// fails fast (non-zero, naming the API URL) when the QA server is not up.

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'child_process';
import {
  existsSync, readFileSync, readdirSync, mkdtempSync, rmSync, mkdirSync, writeFileSync, chmodSync, realpathSync,
} from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import { readExecutionContractFrom } from '../../hooks/lib/qa-contract.js';
import { TRANSITION_MATRIX } from '../../../packages/shared/src/stages';

const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const SCRIPT = join(REPO_ROOT, 'scripts', 'qa', 'item-commits-sandbox.sh');

describe('WI-343 item-commits QA sandbox', () => {
  it('declares the cli surface (alongside web) in the repo execution contract', () => {
    const contract = readExecutionContractFrom(REPO_ROOT);
    expect(contract.surfaces).toContain('cli');
    expect(contract.surfaces).toContain('web');
  });

  it('ships a parseable script that builds into the sandbox and never touches the real ateam binaries', () => {
    expect(existsSync(SCRIPT)).toBe(true);

    const syntax = spawnSync('bash', ['-n', SCRIPT], { encoding: 'utf8' });
    expect(syntax.status).toBe(0);

    const src = readFileSync(SCRIPT, 'utf8');
    expect(src).toMatch(/packages\/ateam-cli/);
    expect(src).toMatch(/go build/);
    expect(src).not.toMatch(/go install/);
    // No write may target the dev binary or the plugin wrapper's binary.
    expect(src).not.toMatch(/(>|-o|cp|mv|ln)\s+[^\n]*(go\/bin\/ateam|bin\/ateam-bin)/);
    // The stub gh is part of the sandbox contract.
    expect(src).toMatch(/gh-calls\.log/);
    expect(src).toMatch(/GH_STUB_AUTH/);
  });

  it('fails fast with a non-zero exit naming the API URL when the QA server is not up', () => {
    const home = mkdtempSync(join(tmpdir(), 'wi343-'));
    try {
      const deadUrl = 'http://127.0.0.1:1';
      const res = spawnSync('bash', [SCRIPT], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        timeout: 240_000,
        env: { ...process.env, HOME: home, TMPDIR: home, ATEAM_API_URL: deadUrl, SANDBOX_ALLOW_API_URL: deadUrl },
      });
      expect(res.status).not.toBe(0);
      expect(`${res.stdout}${res.stderr}`).toContain(deadUrl);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  }, 250_000);

  // ---- Hermetic full runs: fake curl/go on PATH, real bash/git/jq ----------
  // The fake `go build -o X` writes a recording `ateam` at X. Every ateam call
  // appends "<ATEAM_API_URL>|<args>" to calls.log, so we can assert on what the
  // script would send to a real API without one running.
  // The fake ateam is stateful: createItem allocates ids, moveItem enforces the
  // real TRANSITION_MATRIX (imported, not retyped), and every board move records
  // the context it ran in. Item state lives in <root>/state/<id>.{stage,title,impl}.
  const FAKE_ATEAM = String.raw`#!/usr/bin/env bash
ROOT='__ROOT__'
STATE="$ROOT/state"; mkdir -p "$STATE"
echo "$ATEAM_API_URL|$*" >> "$ROOT/calls.log"
echo "$0" >> "$ROOT/binaries.log"
arg() { local want="$1"; shift; while [ $# -gt 0 ]; do [ "$1" = "$want" ] && { echo "$2"; return; }; shift; done; }
item_json() { printf '{"id":"%s","title":"%s","stageId":"%s","stage":"%s"}' "$1" "$(cat "$STATE/$1.title")" "$(cat "$STATE/$1.stage")" "$(cat "$STATE/$1.stage")"; }
case " $* " in
  *" getProject "*) exit 1 ;;
  *" pool init "*)
    git -C "$PWD" status --porcelain=v1 --untracked-files=all > "$ROOT/pool-init-status.log" 2>/dev/null
    exit 0 ;;
  *" createMission "*)
    case "$*" in *--prdPath*) ;; *) echo 'required flag(s) "prdPath" not set' >&2; exit 1 ;; esac
    rm -rf "$STATE"; mkdir -p "$STATE"
    echo '{"data":{"id":"M-FAKE-001"}}' ;;
  *" createItem "*)
    n=$(( $(cat "$STATE/.next" 2>/dev/null || echo 500) + 1 )); echo "$n" > "$STATE/.next"
    id="WI-$n"
    arg --title "$@" > "$STATE/$id.title"
    arg --outputs.impl "$@" > "$STATE/$id.impl"
    arg --outputs.test "$@" > "$STATE/$id.test"
    echo briefings > "$STATE/$id.stage"
    printf '{"success":true,"data":%s}\n' "$(item_json "$id")" ;;
  *" moveItem "*)
    [ "$FAKE_FAIL_MOVE" = 1 ] && { echo 'INTERNAL: move failed' >&2; exit 1; }
    id="$(arg --itemId "$@")"; to="$(arg --toStage "$@")"
    [ -f "$STATE/$id.stage" ] || { echo "ITEM_NOT_FOUND: $id" >&2; exit 1; }
    from="$(cat "$STATE/$id.stage")"
    grep -qx "$from $to" "$ROOT/matrix.txt" || { echo "INVALID_TRANSITION: $from -> $to" >&2; exit 1; }
    impl="$(cat "$STATE/$id.impl")"
    dirty=0; [ -n "$(git -C "$PWD" status --porcelain -- "$impl" 2>/dev/null)" ] && dirty=1
    branch="$(git -C "$PWD" branch --show-current 2>/dev/null)"
    echo "$ATEAM_API_URL|$0|$PWD|$ATEAM_PROJECT_ID|$ATEAM_MISSION_ID|$branch|$id|$from|$to|$dirty" >> "$ROOT/moves.log"
    # Model itemcommit.Attribute: it compares each declared output, as a string, to the
    # repo-relative paths of git status --untracked-files=all. Record which declared
    # paths of this item (own) and of other items (other) that comparison would match.
    changed="$(git -C "$PWD" status --porcelain=v1 --untracked-files=all 2>/dev/null | cut -c4-)"
    own=""; other=""
    for sf in "$STATE"/WI-*.stage; do
      [ -f "$sf" ] || continue
      oid="$(basename "$sf" .stage)"
      for kind in impl test; do
        p="$(cat "$STATE/$oid.$kind" 2>/dev/null)"
        [ -n "$p" ] || continue
        if printf '%s\n' "$changed" | grep -qxF -- "$p"; then
          if [ "$oid" = "$id" ]; then own="$own $kind"; else other="$other $oid"; fi
        fi
      done
    done
    echo "$id|$to|own:$own|other:$other" >> "$ROOT/attribution.log"
    echo "$to" > "$STATE/$id.stage"
    printf '{"success":true,"data":%s}\n' "$(item_json "$id")" ;;
  *" listItems "*)
    out=""; for f in "$STATE"/WI-*.stage; do [ -f "$f" ] || continue; id="$(basename "$f" .stage)"; [ -n "$out" ] && out="$out,"; out="$out$(item_json "$id")"; done
    printf '{"success":true,"data":[%s]}\n' "$out" ;;
  *" getItem "*)
    id="$(arg --id "$@")"; if [ -z "$id" ]; then for id; do :; done; fi
    [ -f "$STATE/$id.stage" ] || { echo "ITEM_NOT_FOUND: $id" >&2; exit 1; }
    printf '{"success":true,"data":%s}\n' "$(item_json "$id")" ;;
esac
exit 0
`;

  function fakeToolbox(root) {
    const bin = join(root, 'fakebin');
    mkdirSync(bin, { recursive: true });
    const log = join(root, 'calls.log');
    const curlLog = join(root, 'curl.log');
    const put = (name, body) => {
      writeFileSync(join(bin, name), `#!/usr/bin/env bash\n${body}\n`);
      chmodSync(join(bin, name), 0o755);
    };
    writeFileSync(join(root, 'fake-ateam.sh'), FAKE_ATEAM.replace('__ROOT__', root));
    writeFileSync(
      join(root, 'matrix.txt'),
      Object.entries(TRANSITION_MATRIX).flatMap(([from, tos]) => tos.map((to) => `${from} ${to}\n`)).join(''),
    );
    put('curl', `echo "$*" >> '${curlLog}'\necho '[]'\nexit 0`);
    put(
      'go',
      `out=""\nwhile [ $# -gt 0 ]; do [ "$1" = "-o" ] && out="$2"; shift; done\n` +
        `cp '${join(root, 'fake-ateam.sh')}' "$out"\nchmod +x "$out"`,
    );
    return { bin, log, curlLog };
  }

  function runSandbox(root, extraEnv) {
    const { bin, log, curlLog } = fakeToolbox(root);
    const env = { ...process.env, ...extraEnv };
    delete env.ATEAM_MISSION_ID;
    delete env.ATEAM_PROJECT_ID;
    if (!('SANDBOX_ALLOW_API_URL' in extraEnv)) delete env.SANDBOX_ALLOW_API_URL;
    if (!('ATEAM_API_URL' in extraEnv)) delete env.ATEAM_API_URL;
    env.PATH = `${bin}:${process.env.PATH}`;
    const res = spawnSync('bash', [SCRIPT], {
      cwd: root, encoding: 'utf8', timeout: 60_000, env,
    });
    const calls = existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean) : [];
    return { res, calls, curlLog };
  }

  describe('hermetic runs with a fake toolchain', () => {
    let root;
    const fresh = () => {
      root = realpathSync(mkdtempSync(join(tmpdir(), 'wi343-run-')));
      return root;
    };
    const cleanup = () => root && rmSync(root, { recursive: true, force: true });

    it('passes --prdPath to createMission so the mission is created and the items are seeded', () => {
      const r = fresh();
      try {
        const { res, calls } = runSandbox(r, { SANDBOX: join(r, 'sbx') });
        const create = calls.find((c) => c.includes('createMission'));
        expect(create, res.stderr).toBeDefined();
        expect(create).toMatch(/--prdPath\s+\S+/);
        expect(res.status, res.stderr).toBe(0);
        expect(calls.filter((c) => c.includes('createItem')).length).toBeGreaterThanOrEqual(2);
        expect(res.stdout).toContain("ATEAM_MISSION_ID='M-FAKE-001'");
      } finally { cleanup(); }
    });

    it('never sends ateam calls to an ambient ATEAM_API_URL (the live :5566 API); defaults to :5567 or refuses', () => {
      const r = fresh();
      try {
        const live = 'http://localhost:5566';
        const { res, calls } = runSandbox(r, { SANDBOX: join(r, 'sbx'), ATEAM_API_URL: live });
        for (const c of calls) {
          expect(c.split('|')[0]).not.toContain(':5566');
        }
        if (res.status === 0) {
          expect(calls.length).toBeGreaterThan(0);
          expect(calls.every((c) => c.startsWith('http://localhost:5567|'))).toBe(true);
          expect(res.stdout).toContain("ATEAM_API_URL='http://localhost:5567'");
        } else {
          expect(calls).toEqual([]);
        }
      } finally { cleanup(); }
    });

    // ---- Non-default API URL needs an exact opt-in ----
    const OTHER_URL = 'http://qa.example.invalid:8080';
    const seedingCalls = (calls) => calls.filter((c) => /createProject|createMission|createItem|moveItem|pool/.test(c));

    it('refuses a reachable non-default API URL without opt-in, names the URL and the opt-in, and seeds nothing', () => {
      const r = fresh();
      try {
        for (const url of [OTHER_URL, `${OTHER_URL}/`]) {
          const { res, calls } = runSandbox(r, { SANDBOX: join(r, 'sbx'), ATEAM_API_URL: url });
          expect(res.status).not.toBe(0);
          expect(res.stderr).toContain(OTHER_URL);
          expect(res.stderr).toContain('SANDBOX_ALLOW_API_URL');
          expect(seedingCalls(calls)).toEqual([]);
          expect(calls).toEqual([]);
        }
        expect(existsSync(join(r, 'sbx'))).toBe(false);
        // The refusal comes before the reachability probe.
        expect(existsSync(join(r, 'curl.log'))).toBe(false);
      } finally { cleanup(); }
    });

    it('does not accept a stale or mismatched opt-in for a different URL', () => {
      const r = fresh();
      try {
        for (const allow of ['1', 'http://other.example.invalid:9']) {
          const { res, calls } = runSandbox(r, { SANDBOX: join(r, 'sbx'), ATEAM_API_URL: OTHER_URL, SANDBOX_ALLOW_API_URL: allow });
          expect(res.status, `allow=${allow}`).not.toBe(0);
          expect(calls).toEqual([]);
        }
      } finally { cleanup(); }
    });

    it('proceeds against a non-default API URL when SANDBOX_ALLOW_API_URL matches it exactly', () => {
      const r = fresh();
      try {
        const { res, calls } = runSandbox(r, { SANDBOX: join(r, 'sbx'), ATEAM_API_URL: OTHER_URL, SANDBOX_ALLOW_API_URL: OTHER_URL });
        expect(res.status, res.stderr).toBe(0);
        expect(calls.length).toBeGreaterThan(0);
        expect(calls.every((c) => c.startsWith(`${OTHER_URL}|`))).toBe(true);
        expect(res.stdout).toContain(`ATEAM_API_URL='${OTHER_URL}'`);
      } finally { cleanup(); }
    });

    it('refuses the live :5566 API even when the opt-in names it', () => {
      const r = fresh();
      try {
        for (const live of ['http://localhost:5566', 'http://localhost:5566/']) {
          const { res, calls } = runSandbox(r, { SANDBOX: join(r, 'sbx'), ATEAM_API_URL: live, SANDBOX_ALLOW_API_URL: live });
          expect(res.status).not.toBe(0);
          expect(res.stderr).toContain('5566');
          expect(calls).toEqual([]);
        }
      } finally { cleanup(); }
    });

    it('refuses to delete unsafe or unmarked SANDBOX paths and leaves their contents intact', () => {
      const r = fresh();
      try {
        const victim = join(r, 'victim');
        mkdirSync(victim);
        writeFileSync(join(victim, 'precious.txt'), 'keep');
        const fakeHome = join(r, 'home');
        mkdirSync(fakeHome);
        writeFileSync(join(fakeHome, 'precious.txt'), 'keep');
        const cases = [
          { name: 'existing unmarked dir', env: { SANDBOX: victim }, keep: victim },
          { name: 'unmarked dir with trailing slash', env: { SANDBOX: `${victim}/` }, keep: victim },
          { name: 'parent of an unmarked dir', env: { SANDBOX: r }, keep: victim },
          { name: 'relative path to unmarked dir', env: { SANDBOX: 'victim' }, keep: victim },
          { name: 'HOME with trailing slash', env: { SANDBOX: `${fakeHome}/`, HOME: fakeHome }, keep: fakeHome },
          { name: 'dot-dot escape', env: { SANDBOX: `${victim}/../victim` }, keep: victim },
        ];
        for (const c of cases) {
          const { res } = runSandbox(r, c.env);
          expect(res.status, `${c.name} should be refused`).not.toBe(0);
          expect(existsSync(join(c.keep, 'precious.txt')), `${c.name} was deleted`).toBe(true);
        }
      } finally { cleanup(); }
    });

    it('still recreates its own previous sandbox from scratch on a rerun', () => {
      const r = fresh();
      try {
        const sbx = join(r, 'sbx');
        const first = runSandbox(r, { SANDBOX: sbx });
        expect(first.res.status, first.res.stderr).toBe(0);
        writeFileSync(join(sbx, 'stale.txt'), 'old');
        const second = runSandbox(r, { SANDBOX: sbx });
        expect(second.res.status, second.res.stderr).toBe(0);
        expect(existsSync(join(sbx, 'stale.txt'))).toBe(false);
        expect(existsSync(join(sbx, 'repo', '.git'))).toBe(true);
      } finally { cleanup(); }
    });

    // ---- Fixture stages (Frankie's blocker: items seeded in briefings are unreachable) ----
    const lines = (r, f) => (existsSync(join(r, f)) ? readFileSync(join(r, f), 'utf8').split('\n').filter(Boolean) : []);
    const readState = (r) => {
      const dir = join(r, 'state');
      if (!existsSync(dir)) return {};
      const out = {};
      for (const f of readdirSync(dir).filter((n) => n.endsWith('.stage'))) {
        const id = f.replace(/\.stage$/, '');
        out[id] = readFileSync(join(dir, f), 'utf8').trim();
      }
      return out;
    };
    const readMoves = (r) => lines(r, 'moves.log').map((l) => {
      const [api, bin, cwd, project, mission, branch, id, from, to, dirty] = l.split('|');
      return { api, bin, cwd, project, mission, branch, id, from, to, dirty };
    });
    const stageCounts = (state) => Object.values(state).reduce((m, s) => ({ ...m, [s]: (m[s] ?? 0) + 1 }), {});

    it('leaves the fixture items where the walk needs them: none in briefings, one in probing, one staged, the rest in ready', () => {
      const r = fresh();
      try {
        const { res } = runSandbox(r, { SANDBOX: join(r, 'sbx') });
        expect(res.status, res.stderr).toBe(0);
        const counts = stageCounts(readState(r));
        expect(counts.briefings ?? 0).toBe(0);
        expect(counts.probing).toBe(1);
        expect(counts.staged).toBe(1);
        expect(counts.ready).toBeGreaterThanOrEqual(3);
        expect(Object.keys(counts).sort()).toEqual(['probing', 'ready', 'staged']);
      } finally { cleanup(); }
    });

    it('runs the legacy moveItem-to-staged step itself, with the branch CLI, against the sandbox API, in the sandbox repo', () => {
      const r = fresh();
      try {
        const sbx = join(r, 'sbx');
        const { res } = runSandbox(r, { SANDBOX: sbx });
        expect(res.status, res.stderr).toBe(0);
        const state = readState(r);
        const toStaged = readMoves(r).filter((m) => m.to === 'staged');
        expect(toStaged).toHaveLength(1);
        const [m] = toStaged;
        expect(m.api).toBe('http://localhost:5567');
        expect(m.bin).toBe(join(sbx, 'bin', 'ateam'));
        expect(m.project).toBe('item-commits-sandbox');
        expect(m.mission).toBe('M-FAKE-001');
        expect(m.cwd).toBe(realpathSync(join(sbx, 'repo')));
        expect(m.branch).toBe('mission/sandbox');
        expect(m.from).toBe('probing');
        expect(state[m.id]).toBe('staged');
        // The commit must be observable: the item's declared output has uncommitted
        // changes when the move happens, otherwise it is a no-change item (no commit).
        expect(m.dirty).toBe('1');
      } finally { cleanup(); }
    });

    it('moves only through the sandbox-built CLI and only against the QA API for every board move', () => {
      const r = fresh();
      try {
        const sbx = join(r, 'sbx');
        const { res } = runSandbox(r, { SANDBOX: sbx });
        expect(res.status, res.stderr).toBe(0);
        const moves = readMoves(r);
        expect(moves.length).toBeGreaterThanOrEqual(3);
        for (const m of moves) {
          expect(m.bin).toBe(join(sbx, 'bin', 'ateam'));
          expect(m.api).toBe('http://localhost:5567');
          expect(m.project).toBe('item-commits-sandbox');
        }
        for (const bin of lines(r, 'binaries.log')) expect(bin).toBe(join(sbx, 'bin', 'ateam'));
      } finally { cleanup(); }
    });

    it('prints a summary naming every sandbox item id with its final stage, and keeps stdout safe to eval', () => {
      const r = fresh();
      try {
        const { res } = runSandbox(r, { SANDBOX: join(r, 'sbx') });
        expect(res.status, res.stderr).toBe(0);
        const state = readState(r);
        const ids = Object.keys(state);
        expect(ids.length).toBeGreaterThanOrEqual(5);
        const allStages = ['briefings', 'ready', 'testing', 'implementing', 'review', 'probing', 'staged', 'done', 'blocked'];
        const out = `${res.stdout}\n${res.stderr}`.split('\n');
        for (const id of ids) {
          // The last line that mentions an id is its summary line: it names the
          // final stage and no other, so a log line written before later moves cannot satisfy this.
          const last = out.filter((l) => l.includes(id)).pop();
          expect(last, `no line mentions ${id}`).toBeDefined();
          const named = allStages.filter((s) => new RegExp(`\\b${s}\\b`).test(last));
          expect(named, `last line for ${id}: ${last}`).toEqual([state[id]]);
        }
        // stdout is eval'd by the walker: every line is an export or a comment.
        for (const l of res.stdout.split('\n').filter(Boolean)) expect(l).toMatch(/^(export |#)/);
        const evald = spawnSync('bash', ['-c', 'set -eu; eval "$1"; echo "$ATEAM_MISSION_ID"', '_', res.stdout], { encoding: 'utf8' });
        expect(evald.status, evald.stderr).toBe(0);
        expect(evald.stdout.trim()).toBe('M-FAKE-001');
      } finally { cleanup(); }
    });

    it('fails without printing exports when a fixture board move fails', () => {
      const r = fresh();
      try {
        const { res } = runSandbox(r, { SANDBOX: join(r, 'sbx'), FAKE_FAIL_MOVE: '1' });
        expect(res.status).not.toBe(0);
        expect(res.stdout).not.toContain('export ATEAM_MISSION_ID');
        expect(res.stderr).toMatch(/ERROR/);
      } finally { cleanup(); }
    });

    // ---- Declared outputs must be repo-relative (attribution compares them to `git status` paths) ----
    const readOutputs = (r) => {
      const dir = join(r, 'state');
      const out = {};
      for (const f of readdirSync(dir).filter((n) => n.endsWith('.stage'))) {
        const id = f.replace(/\.stage$/, '');
        const read = (kind) => (existsSync(join(dir, `${id}.${kind}`)) ? readFileSync(join(dir, `${id}.${kind}`), 'utf8').trim() : '');
        out[id] = { test: read('test'), impl: read('impl') };
      }
      return out;
    };
    const statusPaths = (repo) =>
      spawnSync('git', ['-C', repo, 'status', '--porcelain=v1', '--untracked-files=all'], { encoding: 'utf8' })
        .stdout.split('\n').filter(Boolean).map((l) => l.slice(3));

    const BASELINE_FIXTURES = ['README.md', 'notes/preexisting.txt'];

    it('makes one tracked file modified and one untracked file present when pool init runs, and keeps them out of item outputs', () => {
      const r = fresh();
      try {
        const sbx = join(r, 'sbx');
        const { res } = runSandbox(r, { SANDBOX: sbx });
        expect(res.status, res.stderr).toBe(0);
        const atInit = lines(r, 'pool-init-status.log');
        expect(atInit).toContain(' M README.md');
        expect(atInit).toContain('?? notes/preexisting.txt');
        // Nothing else is dirty at init, and the fixtures stay uncommitted afterwards.
        expect(atInit.map((l) => l.slice(3)).filter((p) => !BASELINE_FIXTURES.includes(p) && p !== '.item-commits-sandbox')).toEqual([]);
        const dirtyNow = statusPaths(join(sbx, 'repo'));
        for (const p of BASELINE_FIXTURES) expect(dirtyNow).toContain(p);
        const outputs = Object.values(readOutputs(r)).flatMap((o) => [o.test, o.impl]);
        for (const p of BASELINE_FIXTURES) expect(outputs).not.toContain(p);
        expect(res.stderr).toContain('README.md');
        expect(res.stderr).toContain('notes/preexisting.txt');
      } finally { cleanup(); }
    });

    it('declares every item outputs.test and outputs.impl as repo-relative paths, unique across items', () => {
      const r = fresh();
      try {
        const sbx = join(r, 'sbx');
        const { res, calls } = runSandbox(r, { SANDBOX: sbx });
        expect(res.status, res.stderr).toBe(0);
        const creates = calls.filter((c) => c.includes('createItem'));
        expect(creates.length).toBeGreaterThanOrEqual(5);
        for (const c of creates) {
          expect(c, 'createItem must pass both outputs').toMatch(/--outputs\.test\s+\S+/);
          expect(c, 'createItem must pass both outputs').toMatch(/--outputs\.impl\s+\S+/);
        }
        const outputs = readOutputs(r);
        const all = [];
        for (const [id, o] of Object.entries(outputs)) {
          for (const [kind, p] of Object.entries(o)) {
            expect(p, `${id} outputs.${kind} is empty`).not.toBe('');
            expect(p.startsWith('/'), `${id} outputs.${kind} is absolute: ${p}`).toBe(false);
            expect(p, `${id} outputs.${kind} embeds $SANDBOX_REPO: ${p}`).not.toContain('$SANDBOX');
            expect(p, `${id} outputs.${kind} embeds the sandbox path: ${p}`).not.toContain(sbx);
            expect(p, `${id} outputs.${kind} embeds the real sandbox path: ${p}`).not.toContain(realpathSync(sbx));
            expect(p.split('/'), `${id} outputs.${kind} escapes the repo: ${p}`).not.toContain('..');
            all.push(p);
          }
        }
        expect(new Set(all).size, 'two outputs share one path').toBe(all.length);
      } finally { cleanup(); }
    });

    it('writes the staged item output file at exactly where its declared outputs.impl points inside SANDBOX_REPO', () => {
      const r = fresh();
      try {
        const sbx = join(r, 'sbx');
        const { res } = runSandbox(r, { SANDBOX: sbx });
        expect(res.status, res.stderr).toBe(0);
        const state = readState(r);
        const stagedId = Object.keys(state).find((id) => state[id] === 'staged');
        const impl = readOutputs(r)[stagedId].impl;
        const written = join(sbx, 'repo', impl);
        expect(existsSync(written), `nothing written at SANDBOX_REPO/${impl}`).toBe(true);
        expect(readFileSync(written, 'utf8').length).toBeGreaterThan(0);
        // The declared path is the one git reports as changed, so it is not left as a stray file.
        expect(statusPaths(join(sbx, 'repo'))).toContain(impl);
        // Besides the staged output and the marker, only the two baseline-dirty fixtures may be dirty.
        expect(statusPaths(join(sbx, 'repo')).filter(
          (p) => p !== impl && p !== '.item-commits-sandbox' && !BASELINE_FIXTURES.includes(p),
        )).toEqual([]);
      } finally { cleanup(); }
    });

    it('lets attribution see the staged item own output as declared (never undeclared) at the staging move', () => {
      const r = fresh();
      try {
        const { res } = runSandbox(r, { SANDBOX: join(r, 'sbx') });
        expect(res.status, res.stderr).toBe(0);
        const rows = lines(r, 'attribution.log').map((l) => l.split('|'));
        const staging = rows.filter(([, to]) => to === 'staged');
        expect(staging).toHaveLength(1);
        const [, , own, other] = staging[0];
        expect(own).toBe('own: impl');
        expect(other).toBe('other:');
      } finally { cleanup(); }
    });

    it('keeps another in-progress item declared files distinct, so attribution holds them back instead of sweeping them in', () => {
      const r = fresh();
      try {
        const sbx = join(r, 'sbx');
        const repo = join(sbx, 'repo');
        const { res } = runSandbox(r, { SANDBOX: sbx });
        expect(res.status, res.stderr).toBe(0);
        const state = readState(r);
        const outputs = readOutputs(r);
        const inProgress = Object.keys(state).filter((id) => state[id] !== 'staged');
        expect(inProgress.length).toBeGreaterThanOrEqual(4);
        // Frankie's scenario: each unfinished item has its declared files uncommitted.
        for (const id of inProgress) {
          for (const p of [outputs[id].impl, outputs[id].test]) {
            mkdirSync(join(repo, p, '..'), { recursive: true });
            writeFileSync(join(repo, p), `// ${id}\n`);
          }
        }
        const changed = statusPaths(repo);
        for (const id of inProgress) {
          // Exact string equality with git's path is what Attribute compares.
          expect(changed, `${id} impl not reported as its declared path`).toContain(outputs[id].impl);
          expect(changed, `${id} test not reported as its declared path`).toContain(outputs[id].test);
        }
      } finally { cleanup(); }
    });

    it('seeds the same stages again on a rerun', () => {
      const r = fresh();
      try {
        const sbx = join(r, 'sbx');
        const first = runSandbox(r, { SANDBOX: sbx });
        expect(first.res.status, first.res.stderr).toBe(0);
        const before = stageCounts(readState(r));
        const second = runSandbox(r, { SANDBOX: sbx });
        expect(second.res.status, second.res.stderr).toBe(0);
        expect(stageCounts(readState(r))).toEqual(before);
      } finally { cleanup(); }
    });
  });
});
