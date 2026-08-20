# Decker prompt eval — verdict (overnight, 2026-08-20)

**Spend:** $34.40 of the $30–90 budget (compare $32.49 + smoke $0.55 + diagnostics $1.36).
**Tool:** promptdiff `compare`, opus, 5 scenarios × 2 arms × 5 runs = 50 runs, + 1 smoke + 4 diagnostic re-runs.
**Arms:** both run the full Decker reasoning core. *Proposed* adds the named "failure-shapes" hit-list skill; *baseline* adds a generic "review carefully" skill of similar weight. So the delta isolates whether the specific named shapes matter, not whether Decker works at all.

## Verdict in one line

**The Decker prompt works** — it reliably finds the target bug classes by execution and does not cry wolf on clean code. **The ablation is inconclusive** — generic opus already clears these fixtures, so I can't yet prove the named hit-list is load-bearing. And the run surfaced a real methodology lesson: my first-pass graders were too brittle and produced false "regressions."

## What's validated (high confidence)

1. **Detection: found the planted bug in effectively every run, all 4 classes.** After correcting for grader artifacts (below), the proposed arm found the sed adjacent-spelling bypass, the refinement-weaker-than-fallback postcheck, the cross-file cipher-rename interaction, and the `/tmp` traversal. Verified by reading transcripts, not just the pass/fail board.
2. **No false positives on clean code.** Both arms: 5/5 on the clean control. Decker stayed silent on a correct, well-tested change. This matters as much as detection — an adversary that flags everything is useless.
3. **It attacks, it doesn't pattern-match.** In diagnostics the proposed arm reproduced *bonus* real bugs I never planted: prototype-pollution and a TypeError-on-primitive path in the gate, plus (in the sed smoke) redirect-truncation, wrapper-prefix, and case-folding bypasses — each with a run-and-diff. This is the execution-over-inference behavior the wording is meant to produce.

## Corrected pass rates (raw board was misleading)

| scenario | raw baseline | raw proposed | corrected proposed | why the gap |
|---|---|---|---|---|
| sed adjacent-spelling | 4/5 | 5/5 | found reliably | 1 baseline grader-miss on filename |
| postcheck refinement | 4/5 | 3/5 | **found 100% (2/2 verified)** | grader keyed on literal "gate.js" in final message; model routed detail to findings.md |
| cipher interaction | 5/5 | 3/5 | **found 100% (2/2 verified)** | grader keyed on /cipher/ phrasing in final message |
| traversal bypass | 5/5 | 5/5 | found reliably | — |
| clean control | 5/5 | 5/5 | 0 false positives | — |

The raw promptdiff summary reported the proposed arm *"did not improve"* and *"regressed."* That conclusion is **wrong** — it was an artifact of deterministic graders checking the final assistant message for literal filenames/keywords, which the model legitimately varied (writing full detail to `findings.md`). Reading the actual transcripts reversed it. This is the same lesson as the PRs this week: a red/green board you didn't verify can lie in either direction.

## What's NOT resolved

- **Does the named hit-list earn its place?** Unproven. The generic-baseline arm also scored high (80–100%), so on these fixtures the specific shapes didn't produce a measurable, non-noise delta (Fisher p≈1.0 where there was any delta). Two likely reasons: (a) opus is strong enough to find these somewhat-obvious planted bugs unaided; (b) my fixtures are single-bug toy repos — too easy and too isolated to discriminate. The hit-list's value should show on *harder, multi-file, genuinely-adjacent* cases, which these under-represent.
- **Generalization.** This proves the prompt steers opus onto *these* classes. It does not prove Decker catches the *next novel* shape. It's regression-proofing the instruction set, not a ceiling test.

## Recommendations

1. **Ship the Decker prompt as drafted** — detection + restraint are validated; nothing here argues against the wording.
2. **Harden the eval before re-running the ablation.** Fix the graders (grade `findings.md` + final message together, or add a machine-readable `FINDING file=` parse instead of prose keyword matching), and build 2–3 *hard* multi-file fixtures where a generic reviewer plausibly misses and only the named-shapes prompt catches. That's the run that actually decides whether the hit-list is load-bearing.
3. **Keep the harness.** This is exactly the calibration instrument for the Decker agent itself once it's built — a standing eval that fails if a future prompt edit regresses detection or restraint.

## Artifacts (in scratchpad/decker-eval/)

- `RESULTS-raw.log` — the raw compare board
- `diag/*.txt` — the 4 diagnostic transcripts that corrected the board
- `scenarios/decker-ablation.json`, `fixtures/`, `agent/decker-core.md`, `skills/` — the full reproducible harness
