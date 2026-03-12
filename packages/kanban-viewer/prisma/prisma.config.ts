import path from 'node:path';
import { defineConfig } from 'prisma/config';

const dbUrl = process.env.DATABASE_URL ?? 'file:./data/dev.db';

export default defineConfig({
  schema: path.join(__dirname, 'schema.prisma'),
  datasource: {
    url: dbUrl,
  },
});
