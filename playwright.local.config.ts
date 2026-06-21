import { defineConfig, devices } from '@playwright/test';

// Local, fully-mocked E2E config — distinct from playwright.config.ts (which
// targets production). Boots `next dev` with a KNOWN throwaway
// AUTH_COOKIE_SECRET so the spec can mint a valid sw_session cookie and pass
// the middleware auth gate WITHOUT any production secret or data. All /api/*
// calls are intercepted in the spec, so nothing touches Supabase/Evolution and
// no real WhatsApp message can be sent.
export const TEST_SECRET = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

export default defineConfig({
  testDir: './__tests__/e2e-local',
  timeout: 60_000,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:3000',
    screenshot: 'only-on-failure',
    trace: 'off',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'npx next dev -p 3000',
    url: 'http://localhost:3000',
    timeout: 180_000,
    reuseExistingServer: true,
    env: {
      AUTH_COOKIE_SECRET: TEST_SECRET,
      // Dummy values so nothing throws at module load. The handlers that read
      // these are intercepted by Playwright and never actually run.
      NEXT_PUBLIC_SUPABASE_URL: 'http://localhost:54321',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test-anon-key',
      SUPABASE_URL: 'http://localhost:54321',
      SUPABASE_SERVICE_ROLE_KEY: 'test-service-key',
    },
  },
});
