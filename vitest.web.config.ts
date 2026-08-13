import { defineConfig } from 'vitest/config';

/**
 * A second, separate test suite for the React components.
 *
 * It deliberately does NOT use `defineWorkersConfig`. These are pure render
 * tests: they call `renderToStaticMarkup` on a component with fixture props
 * and read the resulting HTML string. Booting a Workers runtime for that would
 * be slower and would buy nothing, and `react-dom/server` runs in plain node
 * with no DOM library at all.
 *
 * The frontend is where every product-layer defense either becomes visible to
 * a user or silently stops mattering, and two of its states cannot be reached
 * by clicking through the app, so they cannot be checked by hand. That is what
 * this suite is for.
 */
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'node',
    include: ['test/web/**/*.test.tsx'],
  },
});
