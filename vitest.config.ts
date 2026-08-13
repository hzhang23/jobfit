import path from 'node:path';
import {
  defineWorkersConfig,
  readD1Migrations,
} from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig(async () => {
  const migrations = await readD1Migrations(
    path.join(import.meta.dirname, 'migrations'),
  );

  return {
    test: {
      setupFiles: ['./test/apply-migrations.ts'],
      poolOptions: {
        workers: {
          singleWorker: true,
          isolatedStorage: true,
          // Not wrangler.jsonc. See the comment at the top of
          // wrangler.test.jsonc for why the AI binding cannot be declared here.
          wrangler: { configPath: './wrangler.test.jsonc' },
          miniflare: { bindings: { TEST_MIGRATIONS: migrations } },
        },
      },
    },
  };
});
