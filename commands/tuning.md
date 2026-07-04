---
model: opus
---
# /ai-team:tuning

Run a resumable tuning round: walk recurrence-ranked candidates one card per target surface, and record every verb decision immediately. The expensive part — synthesizing a concrete proposal and an adversarial steelman — only happens for surfaces the operator actually decides to accept or edit (FR-7); everything else is decided from cheap signals already on the candidate list.

## Usage

```
/ai-team:tuning
```

## Arguments

None. Operates on the current project's tuning candidates automatically. Re-running resumes the round rather than starting over.

## Pre-Flight: Environment Check

```bash
echo $ATEAM_PROJECT_ID
```

```text
if empty or "default":
    Output to user:
    "⚠ ATEAM_PROJECT_ID is not configured.
    Run /ai-team:setup to configure your project, then restart Claude Code."
    STOP.
```

## Behavior

### 1. List candidates and group into cards

```bash
ateam tuning candidates --json
```

```text
if empty:
    Output: "No tuning candidates right now — nothing to walk. Candidates come
    from live (open/recurred) RetroLearning recurrence; run missions or
    /ai-team:sweep to surface more, or wait for dismissed items to resurface."
    STOP.
```

Each row is `{ fingerprint, pattern, targetSurface, severity, hits, resurfaced?, dismissalNote? }`. **Group rows by `targetSurface`** into one card per surface — a surface can cluster more than one distinct fingerprint (the draft/cluster route links every live learning for a surface, not just one fingerprint), so a card must list all of them. Order cards by each surface's highest-`hits` row (preserving the candidates list's recurrence ranking).

For each card, derive a **cheap, unsynthesized suggestion** from signals already on the list (do NOT draft proposal text or run a steelman here — that is the expensive step, deferred to §3):
- Multiple high-`hits` fingerprints, none dismissed → lean toward *accept*.
- A single low-`hits`, non-resurfaced row → lean toward *defer* (thin evidence, let it accrue).
- `resurfaced: true` → surface the original `dismissalNote` verbatim so the operator sees what they said last time, and note what changed (new hits or a cross-project hit) that brought it back.

Present this as a suggestion the operator can override, never as a decision already made.

### 2. Track progress this round

Keep a session-local set of surfaces already given a verb this walk (`decided`) plus one for surfaces explicitly `deferred` this round. Skip both when re-presenting cards (candidates can be re-fetched mid-walk, e.g. after a `merge` changes which fingerprints exist) — a card is shown at most once per verb decision per walk.

**Cross-session resumability (NFR-3):** every verb persists immediately via `ateam tuning apply`, so ending the session mid-walk loses nothing. On re-running:
- A surface with an undecided (`draft`) proposal resumes that same draft (`ateam tuning propose` is idempotent per target surface).
- A durably-dismissed surface drops out of `ateam tuning candidates` automatically unless new evidence resurfaces it (FR-8) — re-running naturally skips already-rejected/demoted-away surfaces.
- **Known gap, by design of this mission's scope:** an *accepted* surface has no automatic exclusion from `ateam tuning candidates` — Phase 3's eval/shipped pipeline (which would retire it) doesn't exist yet. If a surface's fingerprint is still live and reappears, call out plainly on its card that it was already accepted in a prior round, so the operator decides with that context rather than the walk silently re-litigating it.

### 3. Draft and present each card

For each not-yet-decided, not-yet-deferred-this-round card, in ranked order:

**a. Infer altitude from the target surface's path** (there is no altitude field on the candidate list):
- `skills/**/SKILL.md` → `skill-text`
- `agents/*.md` → `agent-prompt`
- `scripts/hooks/*.js` → `hook`

If a surface doesn't match any of these, ask the operator which altitude applies before proceeding.

**b. Draft or resume the proposal:**

```bash
ateam tuning propose --target-surface "{targetSurface}" --altitude "{altitude}"
```

This is idempotent — a surface with an already-open draft resumes it (same `id`) instead of creating a duplicate.

**c. Present the card:** target surface, clustered fingerprints with pattern/severity/hits, the resurfaced note if any, and the cheap suggestion from §1. Ask the operator to pick a verb: **accept | edit | merge | demote | reject | defer**.

### 4. Apply the chosen verb

**accept / edit** — the only verbs that pay the synthesis cost. Dispatch `agents/tuning.md` as a subagent, passing the proposal `id`, `targetSurface`, `altitude`, and the clustered fingerprints. The agent owns everything from here: drafting `proposalText` as a concrete change, building the independent adversarial steelman, checking the two-bar promotion gate (objectivity + corroboration across *every* clustered fingerprint) via `ateam tuning candidates`/the corroboration endpoint, and calling `ateam tuning apply --id {id} --verb accept` (or `edit --proposal-text "..."`) itself. Report back to the operator whichever outcome the agent reached:
- Promoted → status is now `accepted`.
- Gate-blocked (422) → relay the agent's reason (which fingerprint(s) failed corroboration, or that the steelman stayed strong) and let the operator immediately choose a different verb (defer/reject/demote/**merge**) for the same card instead of leaving it hanging — merging an uncorroborated fingerprint into an already-corroborated one is a legitimate way past the gate, not a workaround.

Mark the surface `decided`.

**merge** — no synthesis needed; apply directly. **Merge affects every fingerprint currently clustered on this card, not just one you have in mind** — there is no API-level way to merge a single fingerprint out of a multi-fingerprint card; `ateam tuning apply --verb merge` re-points *every* fingerprint linked to this proposal into the target in one call. Only choose merge when **all** of the card's listed fingerprints are genuinely duplicates of the target — if just one is, say so to the operator and prefer leaving the card as-is (or reject/demote the surface) rather than merging and silently collapsing a distinct fingerprint into the target too.

```text
Ask: "Merge into which existing fingerprint? (This will merge EVERY fingerprint on this card, not just one — confirm all of them are duplicates of the target.)"
```
```bash
ateam tuning apply --id {id} --verb merge --merge-into "{targetFingerprint}"
```

Mark `decided`.

**demote** — no synthesis needed; apply directly. Ask for both required fields before calling:

```text
Ask: "Note for the durable dismissal (why this doesn't belong at the current altitude)?"
Ask: "Re-scope to which lower altitude?"
```
```bash
ateam tuning apply --id {id} --verb demote --dismissal-note "{note}" --altitude "{lowerAltitude}"
```

Explain to the operator: this writes a durable dismissal on the *original* altitude carrying the note, and creates a new live proposal at the lower altitude — it will need its own accept/edit pass in a future round once it re-clusters learnings.

Mark `decided`.

**reject** — no synthesis needed; apply directly.

```text
Ask: "Note for the durable dismissal (why this isn't worth acting on)?"
```
```bash
ateam tuning apply --id {id} --verb reject --dismissal-note "{note}"
```

Explain to the operator: this is a durable dismissal (FR-8), not a delete — it stays recorded with the note, and resurfaces automatically only on new evidence (≥3 new RetroLearning hits since the dismissal, or a cross-project hit), never re-presented blind.

Mark `decided`.

**defer** — no synthesis, no prompts.

```bash
ateam tuning apply --id {id} --verb defer
```

Explain: the proposal stays `draft` and simply resurfaces next round (or on re-running this command) rather than being decided now. Mark the surface visited-this-round (`deferred`), but leave it eligible for a future walk.

### 5. Continue until the candidate list is exhausted

Repeat §3–4 for the next ranked, not-yet-`decided`/`deferred` card. Re-fetch `ateam tuning candidates --json` if a `merge` changed which fingerprints exist, so later cards reflect the current clustering.

### 6. Summarize

When no undecided cards remain, report a summary: counts by verb (accepted / edited / merged / demoted / rejected / deferred), and for any accept/edit that was gate-blocked, which surfaces still need corroboration before they can be promoted.

## CLI Commands Used

| Command | Purpose |
|---------|---------|
| `ateam tuning candidates --json` | Recurrence-ranked candidates, including resurfaced dismissals |
| `ateam tuning propose --target-surface <s> --altitude <a>` | Draft or resume a proposal for one target surface |
| `ateam tuning apply --id <n> --verb <v> [...]` | Apply a verb (accept/edit/merge/demote/reject/defer) to a proposal |

## Example

```
/ai-team:tuning
```

## Errors

- **No candidates**: nothing to walk — a valid, complete outcome (see §1)
- **API unavailable**: cannot connect to the A(i)-Team server
- **Gate-blocked accept/edit (422)**: not an error to fix — relay the agent's reason and let the operator choose defer/reject/demote instead
