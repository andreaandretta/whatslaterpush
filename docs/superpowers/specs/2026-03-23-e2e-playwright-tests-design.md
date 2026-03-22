# E2E Playwright Test Suite for WhatsLater

## Overview

End-to-end test suite using Playwright to verify WhatsLater's production site works correctly from a user's perspective. Tests run against `https://whatslaterpush.vercel.app` with hybrid mocking: read-only pages tested live, side-effect APIs intercepted via `page.route()`.

## Architecture

- **Target**: Production URL (`https://whatslaterpush.vercel.app`)
- **Browser**: Chromium only
- **Mocking**: Playwright route interception for APIs with side effects
- **No local server**: Tests hit production directly

## File Structure

```
playwright.config.ts
__tests__/e2e/
├── landing.spec.ts          — Landing page + smoke test static pages
├── auth.spec.ts             — Login and signup flows (mocked)
├── dashboard.spec.ts        — Dashboard, connection form, pairing code (mocked)
├── pricing-checkout.spec.ts — Pricing cards, Stripe checkout redirect (mocked)
├── admin.spec.ts            — Admin dashboard with secret param
└── helpers/
    └── mocks.ts             — Reusable route interceptors
```

## Test Specifications

### landing.spec.ts — No mocks, read-only

| Test | What it verifies |
|------|-----------------|
| Landing page loads | Status 200, page renders |
| Navbar visible | Logo "WhatsLater" present |
| Hero CTA visible | "Inizia" button present and clickable |
| Pricing section | 3 plans displayed: Free, Personal, Business with correct prices |
| FAQ accordion | Click opens/closes answers |
| Footer links | Privacy and Terms links present |
| Smoke: /privacy | Returns 200, has content |
| Smoke: /terms | Returns 200, has content |
| Smoke: /tutorial | Returns 200, has content |

### auth.spec.ts — Mocked auth APIs

| Test | What it verifies |
|------|-----------------|
| Login page loads | Form with email/password fields visible |
| Signup page loads | Registration form visible |
| Login success | Mock auth response → redirect to dashboard |
| Login error | Mock error response → error message visible |
| Signup success | Mock auth response → redirect |

**Mocked**: Supabase auth endpoints

### dashboard.spec.ts — Mocked connect/status APIs

| Test | What it verifies |
|------|-----------------|
| Dashboard loads | Connection form visible |
| Phone input | Can type phone number in field |
| Connect flow | Click connect → mock pairing code response → code displayed |
| Connection status | Mock connected status → dashboard unlocks, messages section appears |
| Message list | Mock message data → messages rendered in list |

**Mocked**: `POST /api/connect`, connection status polling, message list fetch

### pricing-checkout.spec.ts — Mocked checkout API

| Test | What it verifies |
|------|-----------------|
| Pricing cards | 3 plans with correct prices (€0, €4.99, €19.99) |
| Personal plan CTA | Click → mock checkout URL → redirect to Stripe |
| Free plan | No checkout button or shows "Piano attuale" |

**Mocked**: `POST /api/payment/create-checkout`

### admin.spec.ts — No mocks, read-only with secret

| Test | What it verifies |
|------|-----------------|
| Admin without secret | Page does not show data |
| Admin with secret | All 4 sections load: System Health, Business, Stripe, Alerts |
| Section titles | Each section heading visible |
| Chatbot | Input field visible |

**No mocks**: Admin reads production data (acceptable for monitoring dashboard)

## Mock Helpers (`helpers/mocks.ts`)

Reusable functions using `page.route()`:

- `mockConnectApi(page)` — Intercepts `POST /api/connect`, returns fake pairing code
- `mockConnectionStatus(page)` — Intercepts status polling, returns `connected`
- `mockCheckout(page)` — Intercepts `POST /api/payment/create-checkout`, returns Stripe test URL
- `mockAuth(page)` — Intercepts Supabase auth calls, returns fake session
- `mockMessages(page)` — Intercepts message fetch, returns test message array

## Configuration

```typescript
// playwright.config.ts
{
  testDir: './__tests__/e2e',
  baseURL: 'https://whatslaterpush.vercel.app',
  use: {
    browserName: 'chromium',
    screenshot: 'only-on-failure',
    trace: 'on-first-retry'
  },
  retries: 1,
  timeout: 30000
}
```

## Out of Scope

- Real WhatsApp Web automation (requires physical phone)
- Real message sending via Evolution API
- Real Stripe payment processing
- Real Supabase realtime WebSocket testing

## npm Scripts

```json
{
  "test:e2e": "playwright test",
  "test:e2e:ui": "playwright test --ui"
}
```
