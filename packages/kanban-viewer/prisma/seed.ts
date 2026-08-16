import { PrismaClient } from '@prisma/client';
import { PrismaLibSql } from '@prisma/adapter-libsql';
import { getDatabaseUrl } from '../src/lib/db-path';

const adapter = new PrismaLibSql({ url: getDatabaseUrl() });
const prisma = new PrismaClient({ adapter });

/**
 * Default stages configuration matching A-Team pipeline.
 *
 * 9 stages with individual WIP limits:
 * - briefings: Work items not yet started (unlimited)
 * - ready: Items ready for work (WIP 10)
 * - testing: Murdock writes tests (WIP 3)
 * - implementing: B.A. implements (WIP 3)
 * - probing: Amy investigates (WIP 3)
 * - review: Lynch reviews (WIP 3)
 * - staged: Items awaiting Frankie's mission-tail walk (unlimited)
 * - done: Completed items (unlimited)
 * - blocked: Items needing human input (unlimited)
 */
const STAGES = [
  { id: 'briefings', name: 'Briefings', order: 0, wipLimit: null },
  { id: 'ready', name: 'Ready', order: 1, wipLimit: 10 },
  { id: 'testing', name: 'Testing', order: 2, wipLimit: 3 },
  { id: 'implementing', name: 'Implementing', order: 3, wipLimit: 3 },
  { id: 'probing', name: 'Probing', order: 4, wipLimit: 3 },
  { id: 'review', name: 'Review', order: 5, wipLimit: 3 },
  { id: 'staged', name: 'Staged', order: 6, wipLimit: null },
  { id: 'done', name: 'Done', order: 7, wipLimit: null },
  { id: 'blocked', name: 'Blocked', order: 8, wipLimit: null },
] as const;

async function main() {
  console.log('Seeding database...');

  // Create default project first (required for items and missions)
  const defaultProject = await prisma.project.upsert({
    where: { id: 'kanban-viewer' },
    update: {},
    create: {
      id: 'kanban-viewer',
      name: 'Kanban Viewer',
    },
  });
  console.log(`Default project: ${defaultProject.name} (${defaultProject.id})`);

  // Use upsert for idempotency - can run multiple times safely
  console.log('Seeding stages...');
  const upsertOperations = STAGES.map((stage) =>
    prisma.stage.upsert({
      where: { id: stage.id },
      update: {
        name: stage.name,
        order: stage.order,
        wipLimit: stage.wipLimit,
      },
      create: {
        id: stage.id,
        name: stage.name,
        order: stage.order,
        wipLimit: stage.wipLimit,
      },
    })
  );

  const results = await prisma.$transaction(upsertOperations);

  console.log(`Seeded ${results.length} stages:`);
  results.forEach((stage) => {
    const wipDisplay = stage.wipLimit === null ? 'unlimited' : stage.wipLimit;
    console.log(`  - ${stage.name} (order: ${stage.order}, WIP: ${wipDisplay})`);
  });
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error('Seed failed:', error);
    await prisma.$disconnect();
    process.exit(1);
  });
