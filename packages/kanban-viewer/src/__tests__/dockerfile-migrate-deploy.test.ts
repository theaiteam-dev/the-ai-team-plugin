import { readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'

// The Dockerfile lives two directories above this test file:
//   src/__tests__/  →  src/  →  packages/kanban-viewer/  →  Dockerfile
const DOCKERFILE_PATH = resolve(__dirname, '../../Dockerfile')

/**
 * Extracts the builder stage section of a Dockerfile.
 * Spans from "FROM base AS builder" up to (but not including) the next "FROM " declaration.
 * Scoping to the builder stage prevents false positives from runner-stage comments that
 * mention "prisma db push" in a documentation context.
 */
function extractBuilderStage(content: string): string {
  const match = content.match(/FROM base AS builder[\s\S]*?(?=\nFROM )/)
  if (!match) throw new Error('Builder stage (FROM base AS builder) not found in Dockerfile')
  return match[0]
}

/**
 * Extracts the runner stage section of a Dockerfile.
 * Spans from "FROM base AS runner" to end of file.
 */
function extractRunnerStage(content: string): string {
  const match = content.match(/FROM base AS runner[\s\S]*$/)
  if (!match) throw new Error('Runner stage (FROM base AS runner) not found in Dockerfile')
  return match[0]
}

/**
 * Extracts the complete multi-line RUN block that contains a given search string.
 * Dockerfile continuation lines end with a trailing backslash (\).
 * Returns an empty string if no RUN block contains the search text.
 */
function getRunBlockContaining(stage: string, searchText: string): string {
  const lines = stage.split('\n')
  const runStartIndices: number[] = []

  for (let i = 0; i < lines.length; i++) {
    if (/^\s*RUN\s/.test(lines[i])) {
      runStartIndices.push(i)
    }
  }

  for (const start of runStartIndices) {
    const blockLines: string[] = []
    for (let i = start; i < lines.length; i++) {
      blockLines.push(lines[i])
      // A line ending with \ continues the RUN block; the first non-continuation line ends it
      if (!lines[i].trimEnd().endsWith('\\')) break
    }
    const block = blockLines.join('\n')
    if (block.includes(searchText)) return block
  }

  return ''
}

describe('Dockerfile builder stage: prisma migrate deploy', () => {
  let builderStage: string

  beforeAll(() => {
    const content = readFileSync(DOCKERFILE_PATH, 'utf-8')
    builderStage = extractBuilderStage(content)
  })

  // AC1: The 'RUN ... prisma db push ...' line is replaced with 'npx prisma migrate deploy'
  it('uses prisma migrate deploy instead of prisma db push in the builder RUN block', () => {
    expect(builderStage).not.toMatch(/prisma db push/)
    expect(builderStage).toMatch(/prisma migrate deploy/)
  })

  // AC1 (continued): the invocation must reference the schema file so Prisma resolves
  // migrations from the correct location inside the image
  it('invokes prisma migrate deploy with --schema pointing to prisma/schema.prisma', () => {
    expect(builderStage).toMatch(/prisma migrate deploy.*--schema.*schema\.prisma/)
  })

  // AC3: The seed step still runs — and must run AFTER migrate deploy so the schema
  // is fully applied before seed data is inserted
  it('runs npx tsx prisma/seed.ts after prisma migrate deploy in the same RUN block', () => {
    const migratePos = builderStage.indexOf('prisma migrate deploy')
    const seedPos = builderStage.indexOf('npx tsx prisma/seed.ts')
    expect(migratePos).toBeGreaterThan(-1)
    expect(seedPos).toBeGreaterThan(migratePos)
  })

  // AC4: The build step exits non-zero on migrate failure — no failure-swallowing pattern
  // (|| true, 2>/dev/null, ; true) must appear anywhere in the migrate-deploy RUN block
  it('does not suppress migrate deploy exit code with || true, 2>/dev/null, or ; true', () => {
    const runBlock = getRunBlockContaining(builderStage, 'prisma migrate deploy')
    expect(runBlock).not.toBe('')
    expect(runBlock).not.toMatch(/\|\|\s*true/)
    expect(runBlock).not.toMatch(/2>\/dev\/null/)
    expect(runBlock).not.toMatch(/;\s*true\b/)
  })
})

// ── Runner stage ─────────────────────────────────────────────────────────────

describe('Dockerfile runner stage: prisma/scripts availability', () => {
  let runnerStage: string

  beforeAll(() => {
    const content = readFileSync(DOCKERFILE_PATH, 'utf-8')
    runnerStage = extractRunnerStage(content)
  })

  // Bug found by Amy (probing): the backfill-migrations.ts script was absent from
  // the runner image. `find /app -name 'backfill*'` inside the container returned
  // nothing. The entrypoint calls `npx tsx ./prisma/scripts/backfill-migrations.ts`,
  // which exits ERR_MODULE_NOT_FOUND (code 1); set -e then kills every existing-volume
  // boot.
  //
  // The fix: add a COPY from the builder stage so the script is present at runtime.
  it('copies prisma/scripts/ from the builder stage so backfill-migrations.ts is available at runtime', () => {
    expect(runnerStage).toMatch(/COPY.*--from=builder.*prisma\/scripts/)
  })
})
