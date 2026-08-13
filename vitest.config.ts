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
      // test/web is the React render suite. It runs under plain node via
      // vitest.web.config.ts. Without this exclusion those files are collected
      // here as well and run twice, once inside a Workers runtime that has no
      // reason to be booted for a string comparison on rendered HTML.
      exclude: ['**/node_modules/**', '**/dist/**', 'test/web/**'],
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
