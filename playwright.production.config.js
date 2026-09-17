import { defineConfig, devices } from '@playwright/test';

/**
 * Production verification config — runs against the LIVE GitHub Pages deploy.
 * There is no webServer here on purpose; these tests prove the published
 * artifact works, not the dev server.
 *
 *   npm run test:prod            # both projects
 *   npm run test:prod:headed     # on-screen pass only
 */
const BASE_URL = process.env.PROD_URL || 'https://spuds0588.github.io/Directorr/';

const chromeArgs = [
  '--use-fake-ui-for-media-stream',
  '--use-fake-device-for-media-stream',
  '--autoplay-policy=no-user-gesture-required',
  '--mute-audio',
];

export default defineConfig({
  testDir: './production-tests',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  retries: 1,
  reporter: [['list']],

  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    permissions: ['camera', 'microphone'],
    launchOptions: { args: chromeArgs },
  },

  projects: [
    {
      name: 'prod-headless',
      use: { ...devices['Desktop Chrome'], channel: 'chrome', headless: true },
    },
    {
      name: 'prod-headed',
      use: { ...devices['Desktop Chrome'], channel: 'chrome', headless: false },
    },
  ],
});
