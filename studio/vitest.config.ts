import { defineConfig, configDefaults } from 'vitest/config';

// These tests import unversioned local folders (References/ and Snowdon Towers Example/),
// so they are skipped in CI (where those folders do not exist).
const NEEDS_LOCAL_FOLDERS = ['test/ifcx-compose.test.ts', 'test/structure-unit-price.test.ts'];

export default defineConfig({
  resolve: { dedupe: ['three'] },
  test: {
    environment: 'happy-dom',
    exclude: process.env.CI ? [...configDefaults.exclude, ...NEEDS_LOCAL_FOLDERS] : configDefaults.exclude,
  },
});
