/**
 * API error logger — writes structured error lines to:
 *   1. console.error (visible in `docker logs kanban-viewer`)
 *   2. prisma/data/api-errors.log (persisted on the volume mount)
 *
 * Log format (one JSON line per error):
 *   {"ts":"...","route":"POST /api/agents/stop","status":400,"code":"NOT_CLAIMED","message":"...","ctx":{...}}
 *
 * Search examples:
 *   docker logs kanban-viewer 2>&1 | grep "\[API\]"
 *   grep "NOT_CLAIMED" prisma/data/api-errors.log
 *   grep "agent.*murdock" prisma/data/api-errors.log
 */

import fs from 'fs';
import path from 'path';

const LOG_PATH = path.join(process.cwd(), 'prisma', 'data', 'api-errors.log');

export function logApiError(
  route: string,
  status: number,
  code: string,
  message: string,
  ctx?: Record<string, unknown>
): void {
  const entry = {
    ts: new Date().toISOString(),
    route,
    status,
    code,
    message,
    ...(ctx && Object.keys(ctx).length > 0 ? { ctx } : {}),
  };

  const line = JSON.stringify(entry);
  console.error(`[API] ${line}`);

  try {
    fs.appendFileSync(LOG_PATH, line + '\n');
  } catch {
    // Log directory may not exist in test/dev environments — silent fallback to console only
  }
}
