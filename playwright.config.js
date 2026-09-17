import { defineConfig, devices } from '@playwright/test';

const BASE_URL = 'http://localhost:5180';

// Fake camera + mic so getUserMedia returns a synthetic source in CI/headless.
// --mute-audio silences the fake tone while still letting Web Audio route audio
// into the MediaStreamDestination used for recording.
const chromeArgs = [
  '--use-fake-ui-for-media-stream',
  '--use-fake-device-for-media-stream',
  '--autoplay-policy=no-user-gesture-required',
  '--mute-audio',
];
if (process.env.CI) chromeArgs.push('--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage');

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: process.env.CI ? 1 : undefined,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],

  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    permissions: ['camera', 'microphone'],
    launchOptions: { args: chromeArgs },
  },

  projects: [
    {
      // Headless Chrome — the fast, CI-friendly pass.
      name: 'chrome-headless',
      use: { ...devices['Desktop Chrome'], channel: 'chrome', headless: true },
    },
    {
      // Headed Chrome — proves the real, on-screen path (device + display required).
      name: 'chrome-headed',
      use: { ...devices['Desktop Chrome'], channel: 'chrome', headless: false },
    },
  ],

  webServer: {
    command: 'npm run dev',
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
