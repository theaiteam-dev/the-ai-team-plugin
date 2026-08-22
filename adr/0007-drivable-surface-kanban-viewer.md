# ADR 0007: The kanban viewer is this repo's drivable QA surface

**Status:** Accepted
**Date:** 2026-08-15
**Deciders:** Face + Sosa (mission: Staged Stage — Closing the Rework Loop)

## Context

`ateam.config.json` has shipped with `surfaces: []` since Frankie was introduced. `canFrankieDrive()` (`scripts/hooks/lib/qa-contract.js`) returns true only when a declared surface appears in `DRIVABLE_SURFACES`, so an empty array silently disables the mission tail's DoD walk on this repo. Every mission here has been completing without the Frankie half of the tail ever running — not by decision, but by an unset default that fails quiet.

This mission surfaced it because the staged stage exists specifically to make Frankie's failures actionable. Shipping the rework loop on a repo where Frankie never runs would leave half of it unexercised on the very mission that builds it.

## Decision

Declare the kanban viewer (`packages/kanban-viewer`) as a drivable surface, so `canFrankieDrive()` returns true and Frankie walks the DoD on every mission tail on this repo from now on.

The declared surface resolves to a dev server the **pipeline starts fresh per walk** — on a dedicated port that does not collide with the standing Docker container, against a scratch database — not to a long-lived instance an operator maintains by hand.

## Alternatives Considered

- **Keep `surfaces: []` and verify via tests plus Stockwell's review only** — rejected. It ships the Frankie half of the rework loop unexercised, and the gap stays invisible because a skipped walk and a passing walk look identical from the board.
- **Drive the already-running docker-compose container on port 5566** — rejected, and actively dangerous; see Consequences.
- **Have the operator keep a dev server running for Frankie to find** — rejected. A walk that depends on an operator having remembered to start something is a walk that silently passes against yesterday's code.

## Consequences

This is a standing change to every future mission's tail on this repo, not a one-off for this PRD. Frankie will now run — and can now fail — on missions that previously sailed past him, including missions that touch no UI. Expect the first few tails to surface latent DoD-authoring gaps rather than product bugs.

**The 5566 decoy — do not point `devServer` at it.** A Docker container named `kanban-viewer` runs continuously on host port 5566, and it looks exactly like "the kanban viewer, already running." It is not a usable QA target. It is backed by a **prod-copy database** (`packages/kanban-viewer/.env` sets `DATABASE_URL="file:./data/ateam.db"`, copied from the OVH k3s cluster), and it only picks up code changes on `docker compose up -d --build`, never on `restart`. Driving it would mean Frankie passing a walk against stale code and mutating prod-mirrored data — a green tail that proves nothing.

Two related traps sit next to it. The viewer's `dev` script hardcodes `next dev --port 5566`, so `PORT` in `.env` cannot redirect it; a separate script is required, not an env tweak. And that same script runs `prisma migrate deploy` *before* starting Next, against whatever `DATABASE_URL` resolves to — so naively running it with the checked-in `.env` applies migrations to the prod-copy database. Any future mission that adds a migration and also touches the QA server must keep those two facts in view together.

Finally, `devServer.managed` had no code consumer when this was written — `normalizeContract()` in `qa-contract.js` returns only `surfaces`, `qa`, `testing_level`, `evidence`, and `review_tier`, and `devServer` sits outside the execution-contract block entirely. `managed: true` means something only because Frankie's agent instructions act on it. If a future change moves that lifecycle into code, `qa-contract.js` is where the field would have to start being parsed.

Two smaller details not to re-derive: `surfaces` is an array of plain strings drawn from `SURFACE_VALUES`, not rich objects, and unknown values are dropped with a stderr warning rather than an error — so a typo degrades silently back to a skipped walk. And `block-ba-bash-restrictions.js` blocks dev-server commands but returns early for any agent other than B.A., so Frankie starting a server needs no hook change; that early return should not be widened.
