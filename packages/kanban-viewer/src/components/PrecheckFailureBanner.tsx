"use client";

import * as React from "react";
import type { Mission, MissionPrecheckOutput } from "../types/mission";

interface PrecheckFailureBannerProps {
  mission: Mission | null;
}

function formatPrecheckOutput(output: MissionPrecheckOutput): string {
  const sections: string[] = [];
  for (const [checkName, result] of Object.entries(output)) {
    if (!result) continue;
    const lines: string[] = [];
    if (result.timedOut) lines.push('[TIMED OUT]');
    if (result.stdout) lines.push(result.stdout);
    if (result.stderr) lines.push(result.stderr);
    if (lines.length === 0) lines.push('(no output captured)');
    sections.push(`[${checkName}]\n${lines.join('\n')}`);
  }
  return sections.join('\n\n').trim() || '(no output captured)';
}

export function PrecheckFailureBanner({ mission }: PrecheckFailureBannerProps) {
  if (!mission || mission.state !== "precheck_failure") {
    return null;
  }

  const blockers = mission.precheckBlockers ?? [];
  const output = mission.precheckOutput ?? {};
  const formattedOutput = formatPrecheckOutput(output);

  return (
    <div
      data-testid="precheck-failure-banner"
      className="border-l-4 border-amber-500 bg-amber-50 px-4 py-3 text-sm"
    >
      <div className="flex items-center gap-2 mb-2">
        <span className="font-bold text-amber-800 uppercase tracking-wide">
          PRECHECK FAILED
        </span>
        <span className="text-amber-600 font-medium uppercase tracking-wide text-xs">
          / RECOVERABLE
        </span>
      </div>

      {blockers.length > 0 && (
        <ul className="mb-2 space-y-1">
          {blockers.map((blocker, i) => (
            <li
              key={i}
              data-testid="precheck-blocker-item"
              className="text-amber-900"
            >
              {blocker}
            </li>
          ))}
        </ul>
      )}

      <details className="mb-2">
        <summary className="cursor-pointer text-amber-700 text-xs font-medium">
          Raw output
        </summary>
        <pre
          data-testid="precheck-raw-output"
          className="mt-1 text-xs text-amber-800 whitespace-pre-wrap break-all bg-amber-100 rounded p-2 overflow-x-auto"
        >
          {formattedOutput}
        </pre>
      </details>

      <p
        data-testid="precheck-retry-instruction"
        className="text-amber-700 text-xs"
      >
        Re-run /ai-team:run to retry the precheck after fixing the issues above.
      </p>
    </div>
  );
}
