# Decker — proposal + prompt eval harness

Decker is a proposed adversarial branch-review agent: a hostile-outsider
reviewer that attacks the **assembled mission diff** with zero mission context
and reproduces bugs by **execution**, not reading. He exists because PR #55
shipped a two-stop mission escape and multiple write-guard bypasses through
TDD + per-item review + adversarial probing + a FINAL APPROVED — none of which
run the assembled branch as an attacker. See the tracking issue for the full
rationale and design decisions.

This directory is a **proposal and a test harness**, not a wired-in agent. The
agent file lives here as `decker-agent-draft.md` (not `agents/decker.md`) on
purpose: its hooks reference a `block-decker-writes.js` that does not exist
yet, so wiring it into the live plugin before that guard is built would break
dispatch.

## Contents

- `decker-agent-draft.md` — the full proposed agent file (frontmatter + prose).
- `VERDICT.md` — the overnight eval verdict (what was tested, what it proved).
- `RESULTS-raw.log` — the raw `promptdiff compare` board.
- `agent/decker-core.md` — the reasoning core, stripped of plugin plumbing, used
  as the shared system prompt for both eval arms.
- `skills/decker-failure-shapes.md` — the named failure-shapes hit-list (the
  "proposed" arm's extra skill).
- `skills/decker-generic-baseline.md` — a generic "review carefully" note (the
  "baseline" arm), so the comparison isolates whether the *specific* shapes
  matter vs. any competent reviewer.
- `scenarios/decker-ablation.json` — the promptdiff scenario (5 cases × 2 arms).
- `build-fixtures.sh` — regenerates the five seed fixtures under `fixtures/`
  (git repos: committed base = "before", working tree = the proposed change).
  The generated `fixtures/` is gitignored.
- `diag/*.txt` — kept transcripts from the diagnostic re-runs that corrected the
  raw board (see VERDICT.md).

## Reproduce

Requires [`promptdiff`](https://github.com/queso/promptdiff) (`bun install` in a
checkout) and the `claude` CLI.

```bash
cd evals/decker
./build-fixtures.sh                 # regenerate fixtures/01-sed .. 05-clean
# point PD at your promptdiff checkout:
PD=/path/to/promptdiff/promptdiff
bun "$PD" compare --scenario ./scenarios/decker-ablation.json
```

Each planted fixture reproduces a real bug (verify before trusting the eval):

```bash
node fixtures/01-sed/guard.js 'sed -Ei s/a/b/ protected.txt'   # exit 0 = bypass (bug)
node fixtures/04-traversal/writeguard.js '/tmp/../etc/hosts'    # exit 0 = escapes /tmp (bug)
```

## Status of the result (short)

The prompt **works**: it caught all planted bug classes and produced zero false
positives on the clean control. The baseline-vs-hitlist comparison was
**inconclusive** — opus clears these easy single-file fixtures either way, so
whether the named hit-list is load-bearing needs *harder, multi-file* fixtures
to decide. And a methodology note: the raw board's apparent "regressions" were
brittle keyword graders, not missed bugs — caught by reading the transcripts in
`diag/`. Full detail in `VERDICT.md`.
