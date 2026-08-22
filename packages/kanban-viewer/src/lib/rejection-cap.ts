/**
 * Rejection cap configuration.
 *
 * Two independent code paths escalate an item to `blocked` when it has been
 * sent backwards too many times:
 *
 * - POST /api/agents/stop with `outcome: 'rejected'` — Lynch/Amy rejecting a
 *   claimed item mid-pipeline.
 * - POST /api/board/move for `staged -> testing|implementing` — Hannibal
 *   executing a Frankie/Stockwell tail-rework decision (WI-794), where no
 *   agent holds a claim so agentStop is unavailable (adr/0005).
 *
 * Both MUST share one cap; this module is that single source of truth, so
 * neither route has to import the other's module to get at it.
 */

/** Cap used when ATEAM_REJECTION_CAP is unset or unusable. */
export const DEFAULT_REJECTION_CAP = 4;

/**
 * The rejection count at which an item escalates to `blocked` instead of
 * returning to its target stage.
 *
 * Read from the `ATEAM_REJECTION_CAP` environment variable on every call
 * (not cached) so tests and operators can change it without a restart.
 * Non-integer and non-positive values fall back to DEFAULT_REJECTION_CAP.
 */
export function getRejectionEscalationThreshold(): number {
  const raw = process.env.ATEAM_REJECTION_CAP;
  if (raw === undefined || raw === '') return DEFAULT_REJECTION_CAP;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) return DEFAULT_REJECTION_CAP;
  return parsed;
}
