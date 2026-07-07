---
model: opus
---
# /ai-team:tuning

Run a resumable tuning round: walk **actionable** (globally corroborated, and past any defer watermark) fingerprint candidates one card at a time, and record every verb decision immediately. Tuning candidates are fingerprints aggregated **across every project** — tuning improves the plugin itself, a surface shared by every installation, not any one project's copy of it. Cards are views over live `RetroLearning` evidence, not stored drafts: nothing is created just to look at a card. The expensive part — synthesizing a concrete proposal and an independent adversarial steelman — only happens for fingerprints the operator actually decides to `accept` or `edit` (FR-7); everything else is decided from the cheap signals already on the candidate list.

## Usage

```
/ai-team:tuning
```

## Arguments

None. Operates globally across every project's `RetroLearning` evidence automatically. Re-running resumes the round rather than starting over.

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

### 1. List candidates and partition into actionable vs. accruing

```bash
ateam tuning candidates --json
```

```text
if empty:
    Output: "No tuning candidates right now — nothing to walk. Candidates come
    from live (open/recurred) RetroLearning evidence across every project; run
    missions or /ai-team:sweep to surface more, or wait for a deferred
    fingerprint's watermark bar to clear."
    STOP.
```

Each row is `{ fingerprint, pattern, targetSurface, severity, hits, distinctMissions, corroborated, deferredAtMissions, actionable }`. `targetSurface` is a **suggestion** carried over from the fingerprint's most recent learning — it is not agreed until an `accept`/`edit` decides it. `hits` is the fingerprint's full historical row count; `distinctMissions` is the count that actually gates promotion. `corroborated` is the raw `distinctMissions >= 3` signal; `actionable` additionally factors in the defer watermark (`deferredAtMissions`, null if never deferred) — a fingerprint is `actionable` only when it's corroborated AND (never deferred OR `distinctMissions >= deferredAtMissions + 2`). Every candidate is always listed here, deferred or not — deferring never hides a row from this response, it only flips `actionable` to false until enough new evidence arrives.

**Partition the list locally:**
- **Actionable** — `actionable: true`. Equivalent to fetching with `--actionable`.
- **Accruing** — `actionable: false`. Either still building toward the corroboration threshold, or corroborated but still below its defer watermark + 2.

**Walk ONLY the actionable list**, ranked by `hits` (the order the API already returns). Do not present accruing cards one at a time.

```text
if actionable.length === 0:
    Output: "0 actionable candidates — nothing to walk; {accruing.length}
    fingerprint(s) accruing (need >=3 distinct missions, or more evidence past
    a defer watermark)."
    STOP.
else:
    One-line summary before starting the walk: "{actionable.length} actionable,
    {accruing.length} accruing (not shown)."
```

For each actionable card, derive a **cheap, unsynthesized suggestion** from signals already on the row (do NOT draft proposal text or run a steelman here — that is the expensive step, deferred to §3):
- High `distinctMissions` well past the threshold and `deferredAtMissions` is null → lean toward *accept*.
- `deferredAtMissions` is not null (this card was deferred before and has now climbed back over the resurface bar) → note the prior watermark and how many new missions pushed it over (`distinctMissions - deferredAtMissions`), so the operator re-decides with that context.
- Otherwise present neutrally — corroboration is already cleared for every actionable card, so there is no "thin evidence, defer" case in this list the way there was for raw hit counts.

Present this as a suggestion the operator can override, never as a decision already made.

### 2. Track progress this round

Keep a session-local set of fingerprints already given a verb this walk (`decided`) plus one for fingerprints explicitly `deferred` this round. Skip both when re-presenting cards (candidates can be re-fetched mid-walk, e.g. after a `merge` changes which fingerprints exist) — a card is shown at most once per verb decision per walk.

**Cross-session resumability (NFR-3):** every verb writes state immediately, so ending the session mid-walk loses nothing:
- `accept`/`edit` create the agreed proposal (already `status='accepted'`) via a single `ateam tuning propose` call — nothing to resume, there is no draft stage anymore.
- `defer` writes the current `distinctMissions` as a durable watermark via a single `ateam tuning defer --fingerprint <slug>` call — no proposal involved. The fingerprint reappears as actionable once `distinctMissions` climbs 2 past that watermark; re-running `ateam tuning candidates` naturally reflects this the moment new evidence lands, with no session state to lose.
- **Known gap:** an *accepted* fingerprint has **no signal at all** on the candidate row — `ateam tuning candidates` doesn't report whether a fingerprint already has an accepted proposal (only `deferredAtMissions`/`actionable` are exposed, and those only track the defer watermark, not acceptance). If a fingerprint you already accepted in a prior round is still live and reappears as actionable, the walk has no way to detect that automatically. Track fingerprints you've accepted this session yourself if you want to avoid re-litigating them; there is nothing the API can tell you.

### 3. Present each card

For each not-yet-`decided`, not-yet-`deferred`-this-round card, in ranked order:

**a. Infer altitude from the suggested target surface's path** (there is no altitude field on the candidate list):
- `skills/**/SKILL.md` → `skill-text`
- `agents/*.md` → `agent-prompt`
- `scripts/hooks/*.js` → `hook`

If the surface doesn't match any of these, ask the operator which altitude applies before proceeding.

**b. Present the card:** fingerprint slug, pattern, severity, `distinctMissions` (call out roughly how many distinct missions/projects if easy to derive), the suggested `targetSurface` and inferred altitude, the prior watermark if `deferredAtMissions` is set, and the cheap suggestion from §1. Make clear the surface/altitude shown are suggestions — the agreed values are decided as part of `accept`/`edit`, not fixed yet. Ask the operator to pick a verb: **accept | edit | defer** (see §4 for `merge`, which is intentionally not part of this default menu).

### 4. Apply the chosen verb

**accept / edit** — the only verbs that pay the synthesis cost, and the only verbs with a clean, designed path in the shipped API: a single `ateam tuning propose` call both creates the proposal *and* promotes it to `accepted` in one step (Phase A: `propose` is the agreement, not a browsing draft).

- **accept**: agree with the suggested `targetSurface`/inferred `altitude` as-is.
- **edit**: same flow, but the operator supplies a different `targetSurface` and/or `altitude` before dispatching — e.g. the suggested surface is close but not quite right.

Dispatch `agents/tuning.md` as a subagent, passing: the fingerprint slug (or slugs, if you're deliberately bundling more than one — see caveat below), its pattern/severity/`distinctMissions`, and the agreed `targetSurface`/`altitude` (suggested for accept, operator-overridden for edit). The agent owns everything from here: reading the fingerprint's evidence, drafting `proposalText` as a concrete change, building the independent adversarial steelman, re-confirming corroboration (belt-and-suspenders — the API gates this too), and calling:

```bash
ateam tuning propose \
  --fingerprint "{fingerprint}" [--fingerprint "{otherFingerprint}" ...] \
  --target-surface "{targetSurface}" \
  --altitude "{altitude}" \
  --proposal-text "{synthesized text}"
```

Report back to the operator whichever outcome the agent reached:
- Success (201) → status is `accepted`; note the returned proposal `id` — it's not surfaced anywhere else, so record it yourself if you might want to `merge` into or amend this proposal later.
- Gate-blocked (422 `NOT_CORROBORATED`) → this only happens if you bundled in an extra fingerprint that isn't itself corroborated (every actionable card is corroborated on its own, so a single-fingerprint accept/edit should never hit this). Relay the agent's reason and let the operator `defer` the uncorroborated fingerprint instead of bundling it.

**Caveat on bundling:** `--fingerprint` is repeatable, so a proposal can cover more than one fingerprint if they're genuinely the same underlying fix. This is opt-in, not the default one-card-one-fingerprint shape, and every bundled fingerprint must independently be corroborated — the API gates on **all** of them, with no partial credit.

Post-creation, if the operator wants to further amend the text of an already-created proposal (rather than deciding a brand-new one), that's a supported follow-up, not part of the initial walk decision:

```bash
ateam tuning apply --id {id} --verb edit --proposal-text "{amended text}"
```

Mark the fingerprint `decided`.

**defer** — durable "not now" (FR-8), fingerprint-scoped and needing no proposal at all:

```bash
ateam tuning defer --fingerprint "{fingerprint}"
```

This records the fingerprint's CURRENT `distinctMissions` as a watermark (`Fingerprint.deferredAtMissions`). The card drops out of the actionable list (`ateam tuning candidates --actionable`) until `distinctMissions` climbs 2 past that watermark — thin evidence returns after a little more corroboration; a card deferred at exactly the threshold (3) doesn't re-nag until 5+. This is provisional, not permanent: a deferred fingerprint that climbs back over the bar reappears as actionable automatically and can then be `accept`ed — there is no separate "un-defer" step and no dismissal note to write.

```text
Mark the fingerprint visited-this-round (`deferred`) and move on. It will
naturally reappear as actionable once enough new evidence lands — re-running
`ateam tuning candidates` reflects this with no session state to carry.
```

**merge** — intentionally **not** in the default per-card menu. Reserve it for explicit cross-mission slug de-aliasing (two different fingerprint slugs that are actually the same underlying pattern, corroborated across genuinely different missions). It's an advanced action, not a walk decision, for two reasons:
1. It operates via `apply --id {id}` on an *existing* proposal's linked fingerprints — there's no lookup to find a proposal id for a fingerprint after the fact, so it's only usable when you already have one in hand (e.g. one you just created via accept/edit this round).
2. `merge` rejects with 422 `SAME_MISSION_MERGE` if any source fingerprint shares a mission with the target — two fingerprints that only co-occur within one mission are distinct facets of that mission's evidence, not independent corroboration, and can never legitimately reach the distinct-mission threshold by merging.

```text
Ask: "Merge into which existing fingerprint? (Only the fingerprints linked to
proposal {id} are affected — confirm they're genuine duplicates of the target,
corroborated from a DIFFERENT mission.)"
```
```bash
ateam tuning apply --id {id} --verb merge --merge-into "{targetFingerprint}"
```

If offered, mark the source fingerprint(s) `decided`.

### 5. Continue until the actionable list is exhausted

Repeat §3–4 for the next ranked, not-yet-`decided`/`deferred` actionable card. Re-fetch `ateam tuning candidates --json` if a `merge` changed which fingerprints exist, so later cards reflect the current clustering.

### 6. Summarize

When no undecided actionable cards remain, report a summary: counts by verb (accepted / edited / deferred / merged), any proposal `id`s created this round worth remembering (for later `merge`/`edit`/`accept` follow-ups), and the accruing count restated for context.

## CLI Commands Used

| Command | Purpose |
|---------|---------|
| `ateam tuning candidates --json [--actionable]` | Global, recurrence-ranked fingerprint candidates with `actionable`/`deferredAtMissions`; `--actionable` filters to `actionable: true` only |
| `ateam tuning propose --fingerprint <slug> [--fingerprint <slug>...] --target-surface <s> --altitude <a> --proposal-text <text>` | Create a TuningProposal for corroborated fingerprint(s) — the agreement to act; succeeds as `status='accepted'` directly (gated on all linked fingerprints being corroborated) |
| `ateam tuning apply --id <n> --verb <v> [...]` | Apply a verb (`edit`/`merge`) to an **already-existing** proposal |
| `ateam tuning defer --fingerprint <slug>` | Durable "not now" — sets the defer watermark directly on the fingerprint, no proposal required |

## Example

```
/ai-team:tuning
```

## Errors

- **No candidates at all**: nothing to walk — a valid, complete outcome (see §1)
- **0 actionable, N accruing**: also a valid, complete outcome — nothing corroborated (or past its defer watermark) enough to walk yet
- **API unavailable**: cannot connect to the A(i)-Team server
- **Gate-blocked accept/edit (422 `NOT_CORROBORATED`)**: not an error to fix — only reachable via bundling; relay the agent's reason and let the operator `defer` the offending fingerprint instead of bundling it
- **`SAME_MISSION_MERGE` (422)**: `merge` rejected because the source and target only co-occur within one mission — not a bug, a correctness guard; pick different fingerprints or leave them unmerged
- **`FINGERPRINT_NOT_FOUND` (404) on `ateam tuning defer`**: the fingerprint slug doesn't exist — re-check it against `ateam tuning candidates --json` rather than retrying blind
