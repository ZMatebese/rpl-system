import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // node:sqlite is built into Node but still flagged experimental; the
    // warning is noise on every worker start.
    env: { NODE_NO_WARNINGS: '1' },
    pool: 'forks',
  },
});
