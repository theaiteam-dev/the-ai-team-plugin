/**
 * bash-write-scan.js — shared, agent-agnostic Bash write-target scanner.
 *
 * Extracted out of block-frankie-writes.js, which was the first hook to need
 * best-effort detection of "what paths does this shell command write to" (its
 * header comment named the gap this file closes: "block-frankie-writes.js's
 * shell scanner is not factored into a shared lib"). block-pike-writes.js is
 * the second consumer — Pike drives Bash heavily (dev server, curl, the
 * `ateam` CLI) and, before this file existed, could write any project path
 * through shell redirection, `tee`, `sed -i`, `cp`, or `mv` with none of it
 * caught by the Write/Edit-only guard.
 *
 * Everything in this module is PURE with respect to the filesystem and the
 * caller's notion of "project root" or "allowed destination" — it tokenizes
 * shell text and reports write-shaped operations and their target operands.
 * It has no opinion on which targets are allowed; that classification is the
 * caller's job (block-frankie-writes.js's classifyFrankiePath/
 * classifyBashOperand, block-pike-writes.js's mission-brief/scratch checks).
 * The one exception is `collectOperandTargets()`'s `mv` handling, which needs
 * to know whether an operand is "outside the project root" to decide whether
 * a source is a project deletion or an untracked scratch move; rather than
 * hardcode a project-root notion here, that decision is INJECTED as an
 * `isOutsideProjectRoot(operand)` callback (default: treat nothing as
 * outside, which only ever WIDENS what gets classified — the fail-closed
 * direction).
 *
 * This is a best-effort scanner, NOT a filesystem sandbox. Arbitrary shell (a
 * launcher this file's wrapper list doesn't know, a variable-expanded command
 * name, a script file written earlier and then executed) can still defeat a
 * pattern scan. Every caller must treat this as defense-in-depth on top of a
 * Write/Edit guard, never as a claim that the target paths are immutable.
 *
 * Fail-closed posture: a write-shaped statement whose target cannot be
 * extracted (`detectUnverifiableWrite()`) is reported as unverifiable rather
 * than silently yielding zero targets, so callers can deny it instead of
 * assuming it is safe. A statement this scan does not recognize as
 * write-shaped AT ALL (this is pattern-matching, not a shell grammar parser)
 * still yields nothing and is the one residual gap every caller's header
 * comment must keep naming.
 */

/**
 * Strips a single layer of matching double- or single-quotes from a token,
 * if present. Best-effort — this is not a shell tokenizer.
 */
export function stripQuotes(token) {
  if (token.length >= 2) {
    const first = token[0];
    const last = token[token.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return token.slice(1, -1);
    }
  }
  return token;
}

/**
 * Replaces the contents of double- or single-quoted spans with spaces of
 * equal length, preserving the string's length/positions so a delimiter
 * search against the masked string still lines up with the original. Used
 * so a shell metacharacter (`;`, `|`, `>`) that appears INSIDE a quoted
 * argument — e.g. `ateam ... --summary "found bug; needs fix"` — is never
 * mistaken for an actual statement separator or redirect.
 */
export function maskQuotedSpans(s) {
  return s.replace(/"[^"]*"|'[^']*'/g, (m) => ' '.repeat(m.length));
}

/**
 * Finds every heredoc opener (`<<WORD`, `<< WORD`, `<<-WORD`, `<<'WORD'`,
 * `<<"WORD"`) on a single line, in the order bash would read their bodies.
 *
 * Scans character by character tracking quote state, so a `<<` that appears
 * inside a quoted argument (`echo "a <<EOF b"`) is not an opener. A `<<<`
 * here-STRING is skipped — it has no body lines. Returns null when a line
 * contains something opener-shaped whose delimiter cannot be determined
 * (unterminated quote, empty delimiter); callers treat null as "no heredoc
 * recognized" and keep scanning every line, which is the fail-closed
 * direction.
 */
export function findHeredocOpeners(line) {
  const openers = [];
  let quote = null;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '\\') {
      i++;
      continue;
    }
    if (ch !== '<' || line[i + 1] !== '<') {
      continue;
    }
    if (line[i + 2] === '<') {
      // `<<<` is a here-string: the word IS the input, no body lines follow.
      i += 2;
      continue;
    }

    let j = i + 2;
    let dashed = false;
    if (line[j] === '-') {
      dashed = true;
      j++;
    }
    while (line[j] === ' ' || line[j] === '\t') {
      j++;
    }

    let delimiter;
    const q = line[j];
    if (q === "'" || q === '"') {
      const end = line.indexOf(q, j + 1);
      if (end === -1) {
        return null;
      }
      delimiter = line.slice(j + 1, end);
      j = end + 1;
    } else {
      let k = j;
      while (k < line.length && /[A-Za-z0-9_.\-\\]/.test(line[k])) {
        k++;
      }
      delimiter = line.slice(j, k).replace(/\\/g, '');
      j = k;
    }
    if (!delimiter) {
      return null;
    }

    openers.push({ delimiter, dashed });
    i = j - 1;
  }

  return openers;
}

/**
 * Removes heredoc BODY lines from a command before it is split into
 * statements.
 *
 * splitBashStatements() treats a newline as a statement separator, so every
 * line of a heredoc body used to be scanned as if it were a command. That
 * false-positives on an agent's own evidence/brief writes: a markdown
 * blockquote (`> Expected the total to update`) inside
 * `cat > .qa-evidence/M-1/report.md <<EOF` reads as a redirect to a file
 * called "Expected", and prose like `see report>summary` reads as a glued
 * redirect once padRedirectOperators() normalizes it.
 *
 * The heredoc OPENER line is always kept — its own redirect is a real write
 * (`cat > src/app.ts <<EOF` must still block). Only the lines between the
 * opener and its terminator are dropped, and only when the terminator is
 * actually found: an unterminated heredoc (or an opener whose delimiter
 * cannot be parsed) returns the command untouched, so the scan stays
 * fail-closed on anything it does not fully understand.
 */
export function stripHeredocBodies(command) {
  if (!command.includes('<<')) {
    return command;
  }

  const lines = command.split('\n');
  const kept = [];

  for (let i = 0; i < lines.length; i++) {
    kept.push(lines[i]);

    const openers = findHeredocOpeners(lines[i]);
    if (!openers || openers.length === 0) {
      continue;
    }

    // Bash reads the bodies of multiple heredocs on one line in order, each
    // ending at its own delimiter line.
    let idx = i + 1;
    let pending = 0;
    while (idx < lines.length && pending < openers.length) {
      const bodyLine = lines[idx].replace(/\r$/, '');
      const candidate = openers[pending].dashed ? bodyLine.replace(/^\t+/, '') : bodyLine;
      if (candidate === openers[pending].delimiter) {
        pending++;
      }
      idx++;
    }
    if (pending < openers.length) {
      // No terminator in sight — fail closed and scan the whole command.
      return command;
    }
    i = idx - 1;
  }

  return kept.join('\n');
}

/**
 * Splits a compound Bash command into independent statements on the
 * command separators that matter for this scan: &&, ||, ;, |, and
 * newlines. `||` and `&&` MUST be tested before the single-character `|`
 * alternative so a `||` is consumed whole rather than as two `|` splits.
 * Delimiter POSITIONS are found in a quote-masked copy of the command, but
 * the returned statements are sliced from the ORIGINAL string, so quoting
 * is preserved within each statement and a delimiter inside quotes never
 * splits the command.
 *
 * Heredoc bodies are removed first (see stripHeredocBodies) — they are data,
 * not commands, and scanning them as statements false-positives on ordinary
 * prose containing ">".
 */
export function splitBashStatements(rawCommand) {
  const command = stripHeredocBodies(rawCommand);
  const masked = maskQuotedSpans(command);
  // `>\|` MUST be matched ahead of the bare `\|` alternative — it is bash's
  // noclobber-override REDIRECT (`echo x >| file`), not a pipe. Matching it
  // here consumes it so the bare `\|` never sees it; the `continue` below
  // then declines to split there. Without this, `echo x >| specs/x.flow.yaml`
  // split into `echo x >` (a dangling operator whose target is undefined) and
  // a second "statement" whose argv[0] was the path — zero targets extracted,
  // write allowed.
  const delimiterRe = /&&|\|\||>\||[;\n]|\|/g;
  const statements = [];
  let lastIndex = 0;
  let match;
  while ((match = delimiterRe.exec(masked))) {
    if (match[0] === '>|') {
      continue;
    }
    statements.push(command.slice(lastIndex, match.index));
    lastIndex = delimiterRe.lastIndex;
  }
  statements.push(command.slice(lastIndex));
  return statements.map((s) => s.trim()).filter(Boolean);
}

/** fd-duplication targets (`2>&1`, `>&2`, ...) and stream-discard sinks —
 * shell idioms for merging/silencing output streams, never a path a spec,
 * implementation, or test file could live at. Excluded from targets so
 * the extremely common `... > /dev/null 2>&1` pattern doesn't false-block.
 */
export function isBenignRedirectSink(target) {
  return target === '/dev/null' || target === '/dev/stdout' || target === '/dev/stderr' || /^&\d+$/.test(target);
}

export const REDIRECT_OPERATOR_RE = /^(?:\d*>>?|&>>?)$/;
export const REDIRECT_PREFIX_RE = /^(\d*>>?|&>>?)(.+)$/;

/**
 * Surrounds every UNQUOTED output-redirection operator with spaces so the
 * quote-aware tokenizer below always sees the operator and its target as
 * separate tokens.
 *
 * Without this, the tokenizer (`(?:[^\s"']+|"[^"]*"|'[^']*')+`) glues a
 * redirect onto whatever precedes it — `echo hi>specs/x.flow.yaml` becomes
 * the single token `hi>specs/x.flow.yaml`, which matches neither the
 * "operator is its own token" nor the "operator starts the token" case, so
 * ZERO targets were extracted and the write sailed through while the spaced
 * form `echo hi > specs/x.flow.yaml` was blocked. Bash itself treats the two
 * identically, and so must this scan.
 *
 * Hand-rolled rather than a regex because the fd prefix must be peeled off
 * correctly: `2>file` is fd 2 redirected to `file`, but `hi2>file` is the
 * word `hi2` followed by `>file` (a digit run counts as an fd only when it
 * forms its own word). Quoted spans are copied through untouched, so a `>`
 * inside `--description "before > after"` is never treated as an operator.
 * fd-duplication targets stay recognizable: `2>&1` becomes `2> &1`, and
 * `&1` is filtered out downstream by isBenignRedirectSink().
 */
export function padRedirectOperators(statement) {
  let out = '';
  let quote = null;

  for (let i = 0; i < statement.length; i++) {
    const ch = statement[i];

    if (quote) {
      out += ch;
      if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      out += ch;
      continue;
    }
    if (ch !== '>') {
      out += ch;
      continue;
    }

    // Peel any fd prefix already emitted so the whole operator (`2>`, `&>>`)
    // re-emerges as one whitespace-delimited token.
    let prefix = '';
    if (out.endsWith('&') && (out.length === 1 || /\s/.test(out[out.length - 2]))) {
      prefix = '&';
      out = out.slice(0, -1);
    } else {
      let cut = out.length;
      while (cut > 0 && out[cut - 1] >= '0' && out[cut - 1] <= '9') {
        cut--;
      }
      // Trailing digits are an fd number only when they are a word of their
      // own (start of statement or preceded by whitespace).
      if (cut < out.length && (cut === 0 || /\s/.test(out[cut - 1]))) {
        prefix = out.slice(cut);
        out = out.slice(0, cut);
      }
    }

    let operator = `${prefix}>`;
    if (statement[i + 1] === '>') {
      operator += '>';
      i++;
    }
    // `>|` (and `2>|`, `&>|`) is the noclobber-override spelling of `>`: the
    // `|` belongs to the OPERATOR, not to the target. Absorb it so the target
    // is the next token and the `|` is never mistaken for a path of its own.
    if (statement[i + 1] === '|') {
      i++;
    }
    out += ` ${operator} `;
  }

  return out;
}

/**
 * True if `token` is a `sed` in-place flag.
 *
 * The old test was a PREFIX match (`/^(?:-i|--in-place)/`), so it recognized
 * only clusters whose FIRST letter is `i`. `sed -ni`, `sed -Ei` and `sed -ri`
 * edit in place exactly the same way and sailed through, rewriting protected
 * files. Short flags bundle, so the whole letter run matters, not its head.
 *
 * Rules:
 *   - short form: starts with a single "-", is not the bare "-", and its
 *     leading FLAG-LETTER run contains "i". The letter run stops at the first
 *     non-letter, which is what makes `-i.bak` read as the cluster "i" (BSD
 *     suffix form) and `-e's/a/b/'` read as the cluster "e" (attached script,
 *     NOT in-place).
 *   - long form: matched BY NAME (`--in-place`, `--in-place=SUFFIX`), never
 *     letter-scanned — otherwise every long option containing an "i"
 *     (`--quiet`, `--silent`, `--separate`) would read as in-place.
 */
export function isSedInPlaceFlag(token) {
  if (!token.startsWith('-') || token === '-' || token === '--') {
    return false;
  }
  if (token.startsWith('--')) {
    return /^--in-place(?:$|=)/.test(token);
  }
  const flagLetters = /^[A-Za-z]*/.exec(token.slice(1))[0];
  return flagLetters.includes('i');
}

/**
 * Splits a single statement into quote-respecting tokens, after normalizing
 * redirection operator spacing. A quoted argument (e.g. "a > b") stays ONE
 * opaque token, so its contents are never mistaken for an operator or a
 * command name.
 */
const STATEMENT_TOKEN_RE = /(?:[^\s"']+|"[^"]*"|'[^']*')+/g;

export function tokenizeStatement(statement) {
  return padRedirectOperators(statement).match(STATEMENT_TOKEN_RE) || [];
}

/**
 * A path operand with shell wrapping punctuation peeled off.
 *
 * `(echo hi > specs/checkout.flow.yaml)` tokenizes the target as
 * "specs/checkout.flow.yaml)", whose trailing ")" made a protected-path
 * lookup miss. A real path ending in ")" only ever loses characters here,
 * which can widen a match but never narrows one, so this errs fail-closed.
 */
export function normalizeOperand(raw) {
  return stripQuotes(stripQuotes(raw).replace(/^\(+/, '').replace(/[);]+$/, ''));
}

/**
 * The command NAME a token in command position denotes: quotes stripped,
 * subshell/group punctuation peeled (`(rm` → `rm`), and any directory prefix
 * dropped (`/usr/bin/env` → `env`).
 *
 * Only a token in COMMAND POSITION — argv[0] after wrappers are peeled — is
 * ever run through this. A writer's name appearing as an ARGUMENT
 * (`grep -rn "rm -rf specs" .`) is not a command and must never trigger a
 * block.
 */
export function commandName(token) {
  return stripQuotes(token)
    .replace(/^[({]+/, '')
    .split('/')
    .pop();
}

/**
 * Commands that RUN another command: everything after them (once their own
 * flags/assignments/values are skipped) is the real command line. `sudo`,
 * `time` and `nice` are included for the same reason even though most
 * callers have no reason to use them.
 *
 * Per launcher:
 *   - `valueFlags`: separate-form flags whose VALUE is the next token. Without
 *     this, `nice -n 10 sed -i … specs/x` read `10` as the command name and
 *     the real `sed -i` was never recognized. Only flags that unambiguously
 *     require a value are listed — consuming a token that is actually the
 *     command would WEAKEN the scan, so anything ambiguous (xargs' optional-
 *     argument `-i`, sudo's overloaded `-h`) is deliberately left out.
 *   - `leadingOperandRe`: a launcher whose first NON-flag operand is a value,
 *     not a command — `timeout <duration> cmd`, `chrt <priority> cmd`. Exactly
 *     one such token is skipped, and only when it matches the shape of that
 *     launcher's operand, so a mis-parse can never eat the command itself.
 *
 * The list is NOT the load-bearing defense: an unknown launcher leaves the
 * inner command unresolved, and detectUnverifiableWrite() is what stops that
 * from becoming a bypass. Do not grow this list expecting it to be complete.
 */
export const WRAPPER_SPECS = new Map([
  ['env', { valueFlags: new Set(['-u', '--unset', '-C', '--chdir', '-S', '--split-string']) }],
  ['command', {}],
  ['nohup', {}],
  ['exec', { valueFlags: new Set(['-a']) }],
  ['xargs', { valueFlags: new Set(['-n', '-L', '-P', '-I', '-s', '-d', '-E', '-a']) }],
  ['sudo', { valueFlags: new Set(['-u', '--user', '-g', '--group', '-p', '--prompt', '-C']) }],
  ['time', {}],
  ['nice', { valueFlags: new Set(['-n', '--adjustment']) }],
  ['ionice', { valueFlags: new Set(['-c', '--class', '-n', '--classdata', '-p', '--pid', '-u', '--uid']) }],
  [
    'timeout',
    {
      valueFlags: new Set(['-s', '--signal', '-k', '--kill-after']),
      // `5`, `1.5`, `30s`, `2m`, `1h`, `1d` — coreutils' DURATION grammar.
      leadingOperandRe: /^\d+(?:\.\d+)?[smhd]?$/,
    },
  ],
  ['stdbuf', { valueFlags: new Set(['-i', '--input', '-o', '--output', '-e', '--error']) }],
  ['setsid', {}],
  ['chrt', { valueFlags: new Set(['-p', '--pid', '-T', '--sched-runtime']), leadingOperandRe: /^\d+$/ }],
]);

export const WRAPPER_COMMANDS = new Set(WRAPPER_SPECS.keys());

/** A leading `VAR=val` environment-assignment token. */
export const ASSIGNMENT_TOKEN_RE = /^[A-Za-z_][A-Za-z0-9_]*=/;

/**
 * Peels leading environment assignments and command wrappers off a statement's
 * tokens so command recognition sees the REAL command.
 *
 * Recognition read argv[0] literally, so any wrapper defeated it outright:
 * `env FOO=1 sed -i s/a/b/ specs/login.flow.yaml` extracted zero targets and
 * exited 0 because argv[0] was `env`, which matches no rule. Same for
 * `command`, `nohup`, `exec`, `xargs`, `sudo`, and a bare `VAR=val` prefix.
 *
 * Stripping is iterative, so stacked wrappers (`nohup env FOO=1 sed …`) are
 * peeled down to `sed`. A wrapper's own flags, flag VALUES and single leading
 * value operand (`timeout 5 …`) are skipped along with it. This can only ever
 * REVEAL a command that was previously unrecognized — it never removes a
 * command that used to be recognized — so the change is strictly in the
 * fail-closed direction.
 *
 * Launchers outside WRAPPER_SPECS leave the inner command unresolved. That is
 * acceptable ONLY because detectUnverifiableWrite() catches the structural
 * shapes (inline interpreters, mutating `find`, a destructive writer with no
 * extractable target) independently of the launcher list — chasing an
 * ever-growing wrapper list is explicitly not the defense here.
 */
export function stripLeadingWrappers(tokens) {
  let remaining = tokens;
  // Bounded purely as a runaway guard; each iteration consumes >= 1 token.
  for (let depth = 0; depth < 16; depth++) {
    let start = 0;
    while (start < remaining.length && ASSIGNMENT_TOKEN_RE.test(stripQuotes(remaining[start]))) {
      start++;
    }
    if (start >= remaining.length) {
      return []; // assignments only (`FOO=1`) — no command at all
    }
    const head = commandName(remaining[start]);
    if (!WRAPPER_COMMANDS.has(head)) {
      return start === 0 ? remaining : remaining.slice(start);
    }
    const spec = WRAPPER_SPECS.get(head) || {};
    let next = start + 1;
    while (next < remaining.length) {
      const token = stripQuotes(remaining[next]);
      if (!token.startsWith('-') && !ASSIGNMENT_TOKEN_RE.test(token)) {
        break;
      }
      // A separate-form value flag's value is the NEXT token, never the
      // command — skip it too (`nice -n 10 sed …`, `timeout -s KILL 5 sed …`).
      if (spec.valueFlags && spec.valueFlags.has(token)) {
        next++;
      }
      next++;
    }
    // `timeout <duration> cmd` / `chrt <priority> cmd`: exactly one bare VALUE
    // stands between the launcher and the real command.
    if (
      spec.leadingOperandRe &&
      next < remaining.length &&
      spec.leadingOperandRe.test(stripQuotes(remaining[next]))
    ) {
      next++;
    }
    remaining = remaining.slice(next);
    if (remaining.length === 0) {
      return remaining; // a bare wrapper (`env`, `xargs -0`) — nothing to recognize
    }
  }
  return remaining;
}

/**
 * The target paths a recognized writer takes from its OWN operands (not from
 * redirection), given the statement's tokens with wrappers already peeled.
 *
 * Split out of extractBashWriteTargets() so detectUnverifiableWrite() can ask
 * the same question — "how many targets could we actually extract for this
 * writer?" — through the identical code path. Two callers, one rule: the two
 * can never drift into disagreeing about what a writer's targets are.
 *
 * @param {string[]} cmdTokens
 * @param {{ isOutsideProjectRoot?: (operand: string) => boolean }} [opts]
 *   `isOutsideProjectRoot` decides, for `mv`'s SOURCE operands only, whether
 *   an operand is outside the caller's notion of "project root" and should
 *   therefore be skipped rather than classified (see the `mv` branch below).
 *   Defaults to `() => false` — nothing is treated as outside, so every
 *   operand keeps full classification. That default can only ever REVEAL a
 *   target that a caller-specific project-root test would have hidden, never
 *   hide one, so omitting the option is the fail-closed choice.
 */
export function collectOperandTargets(cmdTokens, opts = {}) {
  const { isOutsideProjectRoot = () => false } = opts;
  const targets = [];
  if (cmdTokens.length === 0) {
    return targets;
  }

  const pushTarget = (raw) => {
    if (!raw) return;
    const target = normalizeOperand(raw);
    if (target && !isBenignRedirectSink(target)) {
      targets.push(target);
    }
  };

  const cmd = commandName(cmdTokens[0]);
  const nonFlagArgs = cmdTokens
    .slice(1)
    .map(stripQuotes)
    .filter((w) => w.length > 0 && !w.startsWith('-') && !/[>|;&]/.test(w));

  // `ln` is a write op in BOTH directions: the link name is a new path being
  // created, and the link TARGET is the file every later write through that
  // link actually lands in. `ln -s ../src/services/order.ts .qa-evidence/x`
  // would otherwise be a two-step laundering of an implementation-file write
  // past a guard, so every non-flag arg is classified.
  if (
    cmd === 'rm' ||
    cmd === 'rmdir' ||
    cmd === 'touch' ||
    cmd === 'truncate' ||
    cmd === 'tee' ||
    cmd === 'ln'
  ) {
    nonFlagArgs.forEach(pushTarget);
  } else if (cmd === 'mv') {
    // EVERY operand, not just the destination: an mv SOURCE is a deletion —
    // the file stops existing at that path — so `mv specs/login.flow.yaml
    // specs/login2.flow.yaml` destroys a protected file even though its
    // destination is an innocent new name. Same "write op in BOTH
    // directions" reasoning as `ln` above.
    //
    // Sources are classified by a SOURCE-specific rule, though. Running the
    // default-deny write rule over them blocked Frankie's core evidence move
    // — `mv /tmp/playwright/step3.png .qa-evidence/M-1/step3.png` exited 2
    // while the identical `cp` was allowed — because a scratch source is not
    // a path this repo owns at all. A source for which `isOutsideProjectRoot`
    // answers true is therefore skipped; a source it answers false for keeps
    // full classification, so moving a protected or implementation file
    // still blocks. Destination classification is unchanged: the LAST operand
    // is always classified, scratch or not.
    const destinationIndex = nonFlagArgs.length - 1;
    nonFlagArgs.forEach((operand, index) => {
      if (index !== destinationIndex && isOutsideProjectRoot(normalizeOperand(operand))) {
        return;
      }
      pushTarget(operand);
    });
  } else if (cmd === 'cp') {
    // Destination ONLY — unlike mv, a cp source is read-only: the original
    // file survives untouched, so copying a protected file somewhere else is
    // not a mutation of it. Only the path being written is a target.
    if (nonFlagArgs.length > 0) {
      pushTarget(nonFlagArgs[nonFlagArgs.length - 1]);
    }
  } else if (cmd === 'sed') {
    const hasInPlace = cmdTokens.some((w) => isSedInPlaceFlag(stripQuotes(w)));
    if (hasInPlace) {
      // `sed -i` edits EVERY file operand in place, so classifying only the
      // last one (the right heuristic for an mv/cp DESTINATION) let
      // `sed -i "" s/a/b/ specs/login.flow.yaml .qa-evidence/x.md` rewrite a
      // protected file while only the allowed evidence file was checked.
      //
      // Walk sed's argv rather than the flat non-flag list so the SCRIPT slot
      // is identified correctly and every remaining operand is classified:
      //   - `-e`/`-f`/`--expression`/`--file` supply the script; in their
      //     separate-token form the following token is that script (never a
      //     file), and in their attached form (`-e's/a/b/'`,
      //     `--expression=s/a/b/`) the token carries it.
      //   - otherwise the first bare operand is the script and the rest are
      //     files.
      //   - BSD's empty suffix (`sed -i '' …`) tokenizes to an empty string
      //     and is skipped; `-i.bak` / `--in-place=.bak` are ordinary flags.
      // Boundary: a space-separated BSD suffix (`sed -i .bak s/a/b/ f`) is
      // indistinguishable from a script operand, so it takes the script slot
      // and the real script is classified as a target too — erring toward
      // MORE targets, never fewer, which is the fail-closed direction.
      let scriptSeen = false;
      for (let i = 1; i < cmdTokens.length; i++) {
        const operand = stripQuotes(cmdTokens[i]);
        if (operand.length === 0) {
          continue;
        }
        if (operand.startsWith('-')) {
          if (/^(?:-e|-f)$/.test(operand) || /^--(?:expression|file)$/.test(operand)) {
            scriptSeen = true;
            i++; // the next token is the script/script-file, never an edit target
          } else if (/^(?:-e|-f)./.test(operand) || /^--(?:expression|file)=/.test(operand)) {
            scriptSeen = true;
          }
          continue;
        }
        if (/[>|;&]/.test(operand)) {
          continue; // shell punctuation, not an operand (same rule as nonFlagArgs)
        }
        if (!scriptSeen) {
          scriptSeen = true;
          continue;
        }
        pushTarget(operand);
      }
    }
  }

  return targets;
}

/**
 * Best-effort extraction of write-shaped operations' target paths from a
 * single Bash statement (already split on &&/||/;/|/newline by
 * splitBashStatements). This is NOT a shell parser — variable expansion,
 * subshells, and command substitution can all defeat it. It exists as
 * defense-in-depth on top of a Write/Edit guard (mirrors
 * block-ba-bash-restrictions.js's regex-based approach), not as a sandbox:
 * a statement this function doesn't recognize simply yields no targets,
 * and the caller allows it through (fail open on the unparseable case;
 * fail closed on the recognized one).
 *
 * Tokenizes the statement respecting quotes (a quoted argument, e.g.
 * "a > b", is one opaque token — its contents are never mistaken for a
 * redirect operator or a statement's command/args), then recognizes:
 * output redirection (`>`, `>>`, and fd-qualified variants like `2>`,
 * whether the operator stands alone, is glued to the target (`>file`), is
 * glued to the PRECEDING token (`echo hi>file`), or is the noclobber-override
 * `>|` form — padRedirectOperators() normalizes all four), `tee [-a]`,
 * `mv` (EVERY non-flag operand — a source is a deletion — except a source
 * for which `isOutsideProjectRoot` (see collectOperandTargets) answers true),
 * `cp` (destination only — its source is read-only),
 * `rm`/`rmdir`/`touch`/`truncate`/`ln` (every non-flag arg is a target),
 * `sed -i` (every file operand after the script), and `dd of=`.
 *
 * Command recognition runs on the tokens left after stripLeadingWrappers()
 * peels leading environment assignments and wrapper commands, so
 * `env FOO=1 sed -i …` is recognized as the `sed` it is.
 *
 * @param {string} statement
 * @param {{ isOutsideProjectRoot?: (operand: string) => boolean }} [opts]
 *   Forwarded to collectOperandTargets() — see its doc comment.
 */
export function extractBashWriteTargets(statement, opts = {}) {
  const targets = [];
  const rawTokens = tokenizeStatement(statement);
  if (rawTokens.length === 0) {
    return targets;
  }

  const pushTarget = (raw) => {
    if (!raw) return;
    const target = normalizeOperand(raw);
    if (target && !isBenignRedirectSink(target)) {
      targets.push(target);
    }
  };

  for (let i = 0; i < rawTokens.length; i++) {
    const token = rawTokens[i];
    if (REDIRECT_OPERATOR_RE.test(token)) {
      // Operator is its own token (`echo x > file`) — target is next token.
      pushTarget(rawTokens[i + 1]);
      continue;
    }
    const prefixMatch = token.match(REDIRECT_PREFIX_RE);
    if (prefixMatch) {
      // Operator glued to target (`echo x >file`).
      pushTarget(prefixMatch[2]);
    }
  }

  const ofToken = rawTokens.find((t) => /^of=/.test(stripQuotes(t)));
  if (ofToken) {
    pushTarget(stripQuotes(ofToken).slice('of='.length));
  }

  // Command recognition runs on what is LEFT after leading environment
  // assignments and command wrappers are peeled off (`env FOO=1 sed -i …`),
  // so a wrapper can no longer hide the real command behind argv[0].
  targets.push(...collectOperandTargets(stripLeadingWrappers(rawTokens), opts));
  return targets;
}

/**
 * Interpreters whose INLINE-script/eval flag makes a statement unverifiable:
 * the script body is opaque to a pattern scan and can write anywhere.
 *
 * Keyed by command name; the value tests one argv token and answers "is this
 * an inline-script flag for this interpreter?". Short flags BUNDLE, so the
 * shells/python/perl/ruby cases test the leading flag-LETTER run (the letters
 * before any suffix) rather than the whole token — `bash -lc '…'`,
 * `python3 -Bc '…'` and `perl -pi -e '…'` are the same vector as their
 * unbundled spellings. Long options are matched BY NAME, never letter-scanned,
 * so `--color` is not an eval flag just because it contains a "c".
 *
 * BOUNDARY (deliberate): an interpreter invoked WITHOUT an inline flag —
 * `python3 script.py`, `node app.js`, `bash ./run.sh` — is NOT this case and
 * stays allowed. It is running a FILE, not an opaque inline write, and
 * blocking it would break legitimate use of a project's own scripts. The
 * residual gap that leaves (writing a script into an allowed path and then
 * executing it) is a filesystem-level-immutability problem no pattern scan
 * can close; each caller's header names it as a follow-up.
 */
const flagLetterRun = (token) =>
  token.startsWith('-') && !token.startsWith('--') ? /^[A-Za-z]*/.exec(token.slice(1))[0] : '';

const shellEvalFlag = (token) => flagLetterRun(token).includes('c');

const INLINE_EVAL_INTERPRETERS = new Map([
  ['bash', shellEvalFlag],
  ['sh', shellEvalFlag],
  ['dash', shellEvalFlag],
  ['zsh', shellEvalFlag],
  ['ksh', shellEvalFlag],
  ['python', shellEvalFlag],
  ['python2', shellEvalFlag],
  ['python3', shellEvalFlag],
  // perl's inline forms: -e/-E supply a program, -i/-pi/-ni edit files in
  // place. Any of them writes without naming a target this scan can verify.
  ['perl', (token) => /[eEi]/.test(flagLetterRun(token))],
  ['ruby', (token) => flagLetterRun(token).includes('e')],
  [
    'node',
    (token) =>
      /^--(?:eval|print)(?:$|=)/.test(token) || /[ep]/.test(flagLetterRun(token)),
  ],
  [
    'nodejs',
    (token) =>
      /^--(?:eval|print)(?:$|=)/.test(token) || /[ep]/.test(flagLetterRun(token)),
  ],
]);

/**
 * `find` actions that MUTATE (or write a file) rather than just print. Their
 * target set is a directory walk — unbounded and unverifiable — so a `find`
 * carrying one is blocked outright regardless of the path it starts from.
 * `-fprint`, `-fprintf`, `-fprint0` and `-fls` all write to a named file, so
 * they are matched by prefix.
 */
const FIND_MUTATING_ACTIONS = new Set(['-delete', '-exec', '-execdir', '-ok', '-okdir']);

function isFindMutatingAction(token) {
  return FIND_MUTATING_ACTIONS.has(token) || /^-(?:fprint|fls)/.test(token);
}

/**
 * Destructive writers whose ENTIRE purpose is to modify or remove the paths
 * they are given. If one of these is in command position and NOT ONE target
 * could be extracted from its operands, there is nothing to check against a
 * caller's allowlist — the paths arrive on stdin (`… | xargs rm -f`), from a
 * glob that doesn't resolve here, or from a shape this scan doesn't read.
 * Fail closed.
 */
const DESTRUCTIVE_WRITERS = new Set(['rm', 'rmdir', 'mv', 'truncate', 'tee', 'ln']);

/**
 * Returns a short human-readable description of why a statement performs a
 * write this scan cannot VERIFY lands in an allowlisted location, or null when
 * the statement is not one of those shapes.
 *
 * This is the inversion: extractBashWriteTargets() answers "which paths does
 * this statement write?", and a statement it does not recognize yields zero
 * targets and would otherwise pass. The three shapes below are write-shaped by
 * construction yet yield nothing to classify, so they are blocked on the
 * structure alone rather than on a target:
 *   1. an interpreter running an inline script (`bash -c`, `python3 -c`,
 *      `perl -pi -e`, `node -e`)
 *   2. a `find` carrying a mutating action (`-delete`, `-exec`, `-fprint*`)
 *   3. a destructive writer with zero extractable targets (`… | xargs rm -f`,
 *      `sed -i` with no file operand, `dd` with no `of=`)
 *
 * Recognition runs on argv[0] AFTER wrappers are peeled, so a writer's name
 * appearing as an ARGUMENT (`grep -rn "rm -rf specs" .`) never triggers it.
 *
 * @param {string} statement
 * @param {{ isOutsideProjectRoot?: (operand: string) => boolean }} [opts]
 *   Forwarded to collectOperandTargets() when checking a destructive writer's
 *   target count — see its doc comment.
 */
export function detectUnverifiableWrite(statement, opts = {}) {
  const rawTokens = tokenizeStatement(statement);
  if (rawTokens.length === 0) {
    return null;
  }
  const cmdTokens = stripLeadingWrappers(rawTokens);
  if (cmdTokens.length === 0) {
    return null;
  }

  const cmd = commandName(cmdTokens[0]);
  const args = cmdTokens.slice(1).map(stripQuotes);

  const isEvalFlag = INLINE_EVAL_INTERPRETERS.get(cmd);
  if (isEvalFlag && args.some((token) => isEvalFlag(token))) {
    return `${cmd} is running an inline script, whose writes cannot be verified`;
  }

  if (cmd === 'find' && args.some(isFindMutatingAction)) {
    return 'find carries a mutating action over an unbounded directory walk';
  }

  if (cmd === 'dd') {
    // dd's target is its `of=` operand; without one there is nothing to check.
    return args.some((token) => /^of=/.test(token)) ? null : 'dd names no verifiable output file';
  }

  const isInPlaceSed = cmd === 'sed' && cmdTokens.some((w) => isSedInPlaceFlag(stripQuotes(w)));
  if (DESTRUCTIVE_WRITERS.has(cmd) || isInPlaceSed) {
    if (collectOperandTargets(cmdTokens, opts).length === 0) {
      return `${cmd} is a destructive write with no target this scan can verify`;
    }
  }

  return null;
}
