import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getAndValidateProjectId } from '@/lib/project-utils';
import type { PostcheckResponse, ApiError } from '@/types/api';
import type { PostcheckResult } from '@/types/mission';

/**
 * Parses lint output to count errors.
 * Looks for patterns like "X errors" in the output.
 */
function parseLintErrors(stdout: string, stderr: string): number {
  const combined = `${stdout} ${stderr}`;

  // Match patterns like "5 errors" or "5 errors and 2 warnings"
  const errorMatch = combined.match(/(\d+)\s+errors?/i);
  if (errorMatch) {
    return parseInt(errorMatch[1], 10);
  }

  return 0;
}

// Strips ANSI escape sequences. Broader than SGR-only (`\u001b[...m`) on purpose:
// cursor-control codes such as `\u001b[2K` (erase line) or `\u001b[1G` (column 1) are
// emitted by runners writing to a pty, and would otherwise sit in front of the
// summary line and defeat the `^\s*Tests\b` anchor below.
const ANSI_ESCAPE_RE = /\u001b\[[0-9;?]*[a-zA-Z]/g;

// Check names that are expected to produce test counts. Used only to decide
// whether a zero-count parse deserves a warning (see `unparsed` below) — the
// routing of counts into unit vs e2e buckets is a separate heuristic.
const TEST_SHAPED_CHECK_RE = /test|unit|e2e|spec|vitest|jest|pytest/i;

// Vitest/Jest per-invocation summary line: "Tests  79 passed (79)",
// "Tests: 2 failed, 8 passed, 10 total". Vitest's "Test Files  6 passed (6)"
// line does NOT match (it is "Test Files", not "Tests").
const VITEST_SUMMARY_RE = /^\s*Tests\b/;

// pytest's banner summary: "======== 8 passed in 1.24s ========",
// "=== 1 failed, 7 passed in 0.5s ===". Distinctive enough (leading run of "="
// plus an "<n> passed/failed" phrase) to count safely alongside Tests lines.
// pytest's other banners ("=== test session starts ===", "=== FAILURES ===")
// carry no such phrase and are ignored.
const PYTEST_BANNER_RE = /^\s*=+/;
const COUNT_PHRASE_RE = /\d+\s+(?:passed|failed)/i;

/**
 * Parses test output to extract pass/fail counts.
 * Looks for Vitest/Jest and pytest output patterns.
 *
 * A single check command may chain several test invocations (e.g. ateam.config.json's
 * `"unit-full": "bun run test && (cd client && bun run test)"`), producing one summary
 * line per invocation in the same stdout — every summary line must be summed, and
 * Vitest's "Test Files  N passed" line must not be mistaken for a test count.
 *
 * Chains may also mix runners (`vitest && pytest`, or `pytest && vitest`), so both the
 * "Tests" summary lines and pytest's "=== N passed ===" banners are collected in one
 * pass over the output. No line is counted twice: a line is either a Tests summary or a
 * pytest banner, never both.
 *
 * Boundary (deliberately conservative): only these two shapes are summed. If NEITHER
 * appears, the whole output falls back to a single generic `N passed` / `N failed`
 * match — the historical behavior for unknown runners. That means an unknown runner
 * chained after a recognized one contributes nothing rather than risking a
 * double-count of lines already summed; widen the recognized shapes above rather than
 * loosening the fallback.
 */
function parseTestResults(stdout: string, stderr: string): { passed: number; failed: number } {
  const combined = `${stdout}\n${stderr}`.replace(ANSI_ESCAPE_RE, '');

  let passed = 0;
  let failed = 0;

  const summaryLines = combined
    .split('\n')
    .filter(
      (line) =>
        VITEST_SUMMARY_RE.test(line) ||
        (PYTEST_BANNER_RE.test(line) && COUNT_PHRASE_RE.test(line))
    );
  for (const line of summaryLines) {
    const passedMatch = line.match(/(\d+)\s+passed/i);
    if (passedMatch) {
      passed += parseInt(passedMatch[1], 10);
    }
    const failedMatch = line.match(/(\d+)\s+failed/i);
    if (failedMatch) {
      failed += parseInt(failedMatch[1], 10);
    }
  }
  if (summaryLines.length > 0) {
    return { passed, failed };
  }

  // Fallback for runners with no recognized summary line (e.g. a bare "8 passed").
  const passedMatch = combined.match(/(\d+)\s+passed/i);
  if (passedMatch) {
    passed = parseInt(passedMatch[1], 10);
  }

  const failedMatch = combined.match(/(\d+)\s+failed/i);
  if (failedMatch) {
    failed = parseInt(failedMatch[1], 10);
  }

  return { passed, failed };
}

/**
 * POST /api/missions/postcheck
 *
 * Accepts a pre-computed postcheck result { passed, blockers, output } from the MCP tool.
 * Does NOT execute shell commands itself — the caller (Hannibal) runs checks via Bash
 * in the target project directory and passes results here.
 *
 * State transitions:
 * - passed=true:  running -> completed
 * - passed=false: running -> failed
 *
 * Returns PostcheckResponse with:
 * - passed: boolean indicating if all checks passed
 * - lintErrors: count of lint errors found (parsed from output.lint)
 * - unitTestsPassed: count of passing unit tests (parsed from output.unit)
 * - unitTestsFailed: count of failing unit tests (parsed from output.unit)
 * - e2eTestsPassed: count of passing e2e tests (parsed from output.e2e)
 * - e2eTestsFailed: count of failing e2e tests (parsed from output.e2e)
 * - blockers: array of blocking issues
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const projectValidation = getAndValidateProjectId(request.headers);
    if (!projectValidation.valid) {
      const errorResponse: ApiError = {
        success: false,
        error: projectValidation.error,
      };
      return NextResponse.json(errorResponse, { status: 400 });
    }
    const projectId = projectValidation.projectId;

    // Select the mission this route can actually operate on: the most recently
    // started RUNNING, non-archived mission.
    //
    // This used to be a bare `findFirst({ projectId, archivedAt: null })` with
    // no state filter and no ordering, so SQLite returned the LOWEST rowid. A
    // stale completed-but-unarchived M1 sitting in front of a running M2 made
    // this route answer 400 INVALID_MISSION_STATE forever — and this route is
    // the ONLY way a mission ever reaches `completed`, so it was also the only
    // remediation the Stop gates could offer. Same unordered-findFirst defect
    // that /api/missions/current already fixed; the fix has to follow the bug
    // to every copy of the query.
    const mission = await prisma.mission.findFirst({
      where: {
        projectId,
        archivedAt: null,
        state: 'running',
      },
      orderBy: { startedAt: 'desc' },
    });

    if (!mission) {
      // Nothing runnable. Distinguish "this project has no mission at all"
      // (404 NO_ACTIVE_MISSION) from "there is a mission but it is not in a
      // post-checkable state" (400 INVALID_MISSION_STATE), reporting the state
      // of the mission the operator most likely means — the newest one. Both
      // error semantics predate this change and are preserved.
      const newest = await prisma.mission.findFirst({
        where: { projectId, archivedAt: null },
        orderBy: { startedAt: 'desc' },
      });

      if (!newest) {
        const apiError: ApiError = {
          success: false,
          error: {
            code: 'NO_ACTIVE_MISSION',
            message: 'No active mission found',
          },
        };
        return NextResponse.json(apiError, { status: 404 });
      }

      const apiError: ApiError = {
        success: false,
        error: {
          code: 'INVALID_MISSION_STATE',
          message: `Mission must be in running state to run postcheck. Current state: ${newest.state}`,
        },
      };
      return NextResponse.json(apiError, { status: 400 });
    }

    // Parse request body — must happen before any DB writes so that invalid
    // input returns a 400 without leaving the mission stuck in 'postchecking'.
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      const apiError: ApiError = {
        success: false,
        error: {
          code: 'INVALID_JSON',
          message: 'Request body contains invalid JSON',
        },
      };
      return NextResponse.json(apiError, { status: 400 });
    }

    const { passed, blockers = [], output = {} } = body as Record<string, unknown>;

    // Validate body fields
    if (typeof passed !== 'boolean') {
      const apiError: ApiError = {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: '`passed` must be a boolean',
        },
      };
      return NextResponse.json(apiError, { status: 400 });
    }

    if (!Array.isArray(blockers) || !blockers.every((b: unknown) => typeof b === 'string')) {
      const apiError: ApiError = {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: '`blockers` must be an array of strings',
        },
      };
      return NextResponse.json(apiError, { status: 400 });
    }

    if (typeof output !== 'object' || output === null || Array.isArray(output)) {
      const apiError: ApiError = {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: '`output` must be an object',
        },
      };
      return NextResponse.json(apiError, { status: 400 });
    }

    // Validate that every value in output is a non-null object (not e.g. null or a primitive)
    for (const [key, value] of Object.entries(output as Record<string, unknown>)) {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        const apiError: ApiError = {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: `output["${key}"] must be a non-null object`,
          },
        };
        return NextResponse.json(apiError, { status: 400 });
      }
    }

    // Update mission state to postchecking
    await prisma.mission.update({
      where: { id: mission.id },
      data: { state: 'postchecking' },
    });

    // Log postcheck start
    await prisma.activityLog.create({
      data: {
        projectId,
        missionId: mission.id,
        agent: null,
        message: 'Postcheck started',
        level: 'info',
      },
    });

    // Parse counts from output map dynamically — avoids hardcoding "lint"/"unit"/"e2e"
    // so renamed check keys in ateam.config.json continue to work.
    // Heuristic: check names containing "lint" use parseLintErrors; all others use parseTestResults.
    type CheckOutput = { stdout?: string; stderr?: string; timedOut?: boolean };
    let lintErrors = 0;
    let unitTestsPassed = 0;
    let unitTestsFailed = 0;
    let e2eTestsPassed = 0;
    let e2eTestsFailed = 0;

    for (const [checkName, checkOut] of Object.entries(output as Record<string, CheckOutput>)) {
      const stdout = checkOut.stdout ?? '';
      const stderr = checkOut.stderr ?? '';
      if (checkName.includes('lint')) {
        lintErrors += parseLintErrors(stdout, stderr);
      } else if (checkName.includes('e2e') || checkName.includes('playwright')) {
        const counts = parseTestResults(stdout, stderr);
        e2eTestsPassed += counts.passed;
        e2eTestsFailed += counts.failed;
      } else {
        const counts = parseTestResults(stdout, stderr);
        unitTestsPassed += counts.passed;
        unitTestsFailed += counts.failed;
      }
    }

    // Update mission state based on result
    const newState = passed ? 'completed' : 'failed';
    await prisma.mission.update({
      where: { id: mission.id },
      data: {
        state: newState,
        ...(passed ? { completedAt: new Date() } : {}),
      },
    });

    // A passing result with no measurable output must SAY so — "0 unit tests
    // passing" read as real data in M-20260819-001's retro when the caller had
    // simply omitted `output`. A 0/0 gate result must be distinguishable from
    // "nothing was measured".
    const outputEntries = Object.entries(output as Record<string, CheckOutput>);
    const hasContent = ([, o]: [string, CheckOutput]): boolean =>
      (o.stdout ?? '').trim() !== '' || (o.stderr ?? '').trim() !== '';
    const hasSubmittedOutput = outputEntries.some(hasContent);
    // Only a TEST-shaped check can be expected to yield test counts. Gating on
    // "any non-lint check" made every {lint, typecheck} or {lint, build} config
    // warn on a perfectly clean postcheck, since those checks never print counts.
    const hasTestShapedOutput = outputEntries
      .filter(([name]) => !name.includes('lint') && TEST_SHAPED_CHECK_RE.test(name))
      .some(hasContent);
    const totalTestCounts = unitTestsPassed + unitTestsFailed + e2eTestsPassed + e2eTestsFailed;
    const unmeasured = passed && !hasSubmittedOutput;
    const unparsed = passed && hasTestShapedOutput && totalTestCounts === 0;

    let passedMessage = `Postcheck passed: ${unitTestsPassed} unit tests, ${e2eTestsPassed} e2e tests passing, ${lintErrors} lint errors`;
    if (unmeasured) {
      passedMessage =
        'Postcheck passed: no check output submitted — test counts unmeasured (caller must run the configured checks and include their captured output)';
    } else if (unparsed) {
      passedMessage += ' — warning: submitted check output contained no parsable test counts';
    }

    // Log postcheck results
    await prisma.activityLog.create({
      data: {
        projectId,
        missionId: mission.id,
        agent: null,
        message: passed ? passedMessage : `Postcheck failed: ${blockers.join(', ')}`,
        level: passed ? (unmeasured || unparsed ? 'warn' : 'info') : 'error',
      },
    });

    const result: PostcheckResult = {
      passed,
      lintErrors,
      unitTestsPassed,
      unitTestsFailed,
      e2eTestsPassed,
      e2eTestsFailed,
      blockers,
    };

    const response: PostcheckResponse = {
      success: true,
      data: result,
    };

    return NextResponse.json(response);
  } catch (error) {
    const apiError: ApiError = {
      success: false,
      error: {
        code: 'DATABASE_ERROR',
        message: error instanceof Error ? error.message : 'Failed to run postcheck',
      },
    };
    return NextResponse.json(apiError, { status: 500 });
  }
}
