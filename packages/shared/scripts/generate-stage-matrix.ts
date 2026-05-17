/**
 * generate-stage-matrix.ts
 *
 * Exports TRANSITION_MATRIX and PIPELINE_STAGES from stages.ts to a JSON
 * fixture at packages/shared/fixtures/stage-matrix.json.
 *
 * The Go contract test in packages/ateam-cli/internal/stages/stages_test.go
 * loads this fixture and verifies the hand-coded Go maps mirror it exactly.
 * Any drift between TypeScript and Go fails CI at the Go test, not at runtime.
 *
 * Run via: bun scripts/generate-stage-matrix.ts
 * Or as part of: bun run build  (wired into the build script)
 */

import { mkdirSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

import { PIPELINE_STAGES, TRANSITION_MATRIX } from '../src/stages.js';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const fixturesDir = resolve(scriptDir, '../fixtures');
const outputPath = resolve(fixturesDir, 'stage-matrix.json');

// Serialize TRANSITION_MATRIX — readonly arrays become plain arrays.
const transitionMatrix: Record<string, string[]> = {};
for (const [stage, targets] of Object.entries(TRANSITION_MATRIX)) {
  transitionMatrix[stage] = [...targets];
}

// Serialize PIPELINE_STAGES — only stages with an assigned agent are included.
// nextStage is StageId | null in TS; we serialize null as "" so the Go string
// field has a defined value. (No current pipeline stage has null nextStage.)
const pipelineStages: Record<
  string,
  {
    agent: string;
    agentDisplay: string;
    nextStage: string;
    description: string;
  }
> = {};
for (const [stage, info] of Object.entries(PIPELINE_STAGES)) {
  pipelineStages[stage] = {
    agent: info.agent,
    agentDisplay: info.agentDisplay,
    nextStage: info.nextStage ?? '',
    description: info.description,
  };
}

const fixture = { transitionMatrix, pipelineStages };

mkdirSync(fixturesDir, { recursive: true });
writeFileSync(outputPath, JSON.stringify(fixture, null, 2) + '\n');

console.log(`Generated ${outputPath}`);
