import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'tests/browser',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  use: {
    baseURL: 'http://127.0.0.1:4391',
    browserName: 'chromium',
    viewport: { width: 1280, height: 800 },
  },
  webServer: {
    command: 'pnpm dev --host 127.0.0.1 --port 4391 --ignore-lock',
    url: 'http://127.0.0.1:4391/_emdash/api/health',
    reuseExistingServer: false,
    env: { TEST_EPHEMERAL: '1' },
    timeout: 60_000,
  },
});
