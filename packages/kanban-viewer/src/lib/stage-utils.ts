import type { Stage } from '@/types';

/**
 * Valid stage names in the kanban workflow
 */
const VALID_STAGES: readonly Stage[] = [
  'briefings',
  'ready',
  'testing',
  'implementing',
  'review',
  'probing',
  'staged',
  'done',
  'blocked',
] as const;

/**
 * Type guard to check if a string is a valid Stage
 * @param value - The value to check
 * @returns true if the value is a valid Stage, false otherwise
 */
export function isValidStage(value: unknown): value is Stage {
  return typeof value === 'string' && VALID_STAGES.includes(value as Stage);
}

/**
 * Extracts the stage from a file path
 * @param path - The file path (absolute or relative)
 * @returns The stage name if found and valid, null otherwise
 *
 * @example
 * getStageFromPath('/mission/ready/foo.md') // returns 'ready'
 * getStageFromPath('mission/testing/bar.md') // returns 'testing'
 * getStageFromPath('/some/other/path.md') // returns null
 */
export function getStageFromPath(path: string): Stage | null {
  if (!path) {
    return null;
  }

  // Normalize path separators (handle Windows paths)
  const normalizedPath = path.replace(/\\/g, '/');

  // Look for /mission/ or mission/ in the path
  const missionMatch = normalizedPath.match(/(?:^|\/)mission\/([^\/]+)/);

  if (!missionMatch) {
    return null;
  }

  const potentialStage = missionMatch[1];

  // Validate that it's actually a valid stage
  if (isValidStage(potentialStage)) {
    return potentialStage;
  }

  return null;
}
