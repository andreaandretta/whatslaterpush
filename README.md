# 📱 SchedWhats v7.0

> **Schedule WhatsApp messages using natural language — no app, no dashboard, just your phone.**

![Version](https://img.shields.io/badge/version-7.0.0-brightgreen.svg)
![Next.js](https://img.shields.io/badge/Next.js-14-black.svg)
![TypeScript](https://img.shields.io/badge/TypeScript-5.5-blue.svg)
![Supabase](https://img.shields.io/badge/Supabase-PostgreSQL-3ECF8E.svg)
![Stripe](https://img.shields.io/badge/Stripe-Payments-635BFF.svg)
![License](https://img.shields.io/badge/license-MIT-lightgrey.svg)

---

## 📋 Table of Contents

- [Overview](#-overview)
- [Features](#-features)
- [Architecture](#-architecture)
- [Tech Stack](#-tech-stack)
- [Project Structure](#-project-structure)
- [API Routes](#-api-routes)
- [Database Schema](#-database-schema)
- [Environment Variables](#-environment-variables)
- [Setup & Installation](#-setup--installation)
- [Usage Flow](#-usage-flow)
- [Security](#-security)
- [Design System](#-design-system)
- [UI Components](#-ui-components)
- [Contributing](#-contributing)
- [License](#-license)

---

## 🌟 Overview

**SchedWhats v7.0** is a SaaS platform for scheduling WhatsApp messages using natural language in Italian. It requires no dedicated app — the user interacts entirely through WhatsApp itself.

### How it works

1. The user connects their WhatsApp number via Evolution API (scan QR or pairing code).
2. They open their **"Note to Self"** chat on WhatsApp.
3. They attach a **contact card (vCard)** — the recipient — and write a caption like `"domani alle 9 ciao, come stai?"`.
4. The webhook receives the message, **parses the date in Italian**, and stores the scheduled message in the database.
5. A **cron job** checks for pending messages and sends them via Evolution API at the right time.
6. The user receives a **WhatsApp confirmation** after each action.

### Value Proposition

- Zero-friction UX: everything happens inside WhatsApp.
- Italian natural language date parsing (no UI needed).
- SaaS model: free 7-day trial, then €1.99/month via Stripe.
- Anti-spam rate limiting and automatic retry logic.

<!-- screenshot: dashboard overview -->
<!-- screenshot: WhatsApp scheduling flow -->

---

## ✨ Features

| Feature | Description |
|---|---|
| 🗣️ **Italian NLP Scheduling** | Parse natural language dates: `"domani alle 9"`, `"fra 2 ore"`, `"il 25/12 alle 10"`, `"alle 15:30"`. Supports written numbers (`due ore`, `tre giorni`). |
| 📇 **vCard Integration** | Send a contact card to "Note to Self" to set the recipient. The system extracts the phone number from the vCard automatically. |
| 💳 **Stripe Payments** | Subscription model at €1.99/month. 7-day free trial automatically assigned on first use. Trial expiry enforced before scheduling. |
| 🔁 **Cron Job Delivery** | Automatic message sending via a cron-triggered endpoint. Handles retries (up to 3 attempts with exponential backoff). |
| 🛡️ **Rate Limiting** | In-memory anti-spam protection: 15 msg/min per user, 100 msg/day per user, 18 msg/min per instance, auto-block at 50 msg/day. |
| 📋 **Queue Commands** | Manage the queue via WhatsApp: `lista` (view queue), `annulla` (cancel last), `cancella 2` (cancel by index), `cancella Marco` (cancel by name), `aiuto` (help). |
| ⚡ **Real-time Updates** | Live message queue in the dashboard using Supabase real-time subscriptions. |
| 🎨 **Modern Soft UI** | Clean design with rounded corners, soft shadows, and WhatsApp-green accents. GSAP animations. |
| 🔒 **Secure by Default** | Supabase RLS on all tables, Stripe webhook signature verification, Evolution API key auth. |
| 🐳 **Docker Ready** | Multi-stage Dockerfile for lightweight production builds. |

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         USER'S PHONE                            │
│  WhatsApp ──[vCard + caption]──► Note to Self                   │
└───────────────────────────┬─────────────────────────────────────┘
                            │ webhook event
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                      EVOLUTION API v2                           │
│  Manages WhatsApp instances, forwards events to webhook          │
└───────────────────────────┬─────────────────────────────────────┘
                            │ POST /api/webhook
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                     NEXT.JS APP (SchedWhats)                    │
│                                                                 │
│  ┌─────────────┐   ┌──────────────────┐   ┌─────────────────┐  │
│  │   Webhook   │   │  Italian NLP     │   │  Subscription   │  │
│  │  Handler    │──►│  Date Parser     │   │  Check (Stripe) │  │
│  └──────┬──────┘   └────────┬─────────┘   └────────┬────────┘  │
│         │                  │                       │           │
│         └──────────────────┴───────────────────────┘           │
│                            │                                   │
│                            ▼                                   │
│                    ┌──────────────┐                            │
│                    │   Supabase   │                            │
│                    │  PostgreSQL  │                            │
│                    └──────┬───────┘                            │
│                           │                                    │
│             ┌─────────────┘                                    │
│             │ GET /api/cron/send-messages                      │
│             ▼                                                  │
│  ┌──────────────────┐                                          │
│  │   Cron Job       │──► Evolution API ──► Recipient's Phone   │
│  │  (Rate Limiter)  │                                          │
│  └──────────────────┘                                          │
└─────────────────────────────────────────────────────────────────┘
                            │
                            ▼
                   ┌─────────────────┐
                   │  Stripe Checkout│
                   │  + Webhooks     │
                   └─────────────────┘
```

---

## 🛠️ Tech Stack

### Framework & Runtime
| Library | Version | Purpose |
|---|---|---|
| [Next.js](https://nextjs.org/) | 14 | Full-stack React framework (App Router) |
| [TypeScript](https://www.typescriptlang.org/) | 5.5 | Type safety |
| [React](https://react.dev/) | 18 | UI layer |

### Database & Auth
| Library | Version | Purpose |
|---|---|---|
| [Supabase](https://supabase.com/) | 2.45 | PostgreSQL database + Auth + Real-time |
| `@supabase/ssr` | 0.4 | Server-side Supabase client for Next.js |

### Payments
| Library | Version | Purpose |
|---|---|---|
| [Stripe](https://stripe.com/) | 14.5 | Subscription payments (€1.99/month) |

### Messaging
| Library | Version | Purpose |
|---|---|---|
| [Evolution API](https://evolution-api.com/) | v2 | WhatsApp integration |
| [vcf](https://github.com/nicolo-ribaudo/vcf) | 2.1 | vCard parsing |

### Date & Scheduling
| Library | Version | Purpose |
|---|---|---|
| [date-fns](https://date-fns.org/) | 3.6 | Date manipulation |
| [cron-parser](https://github.com/harrisiirak/cron-parser) | 4.9 | Cron expression parsing |

### UI & Styling
| Library | Version | Purpose |
|---|---|---|
| [Tailwind CSS](https://tailwindcss.com/) | 3.4 | Utility-first CSS framework |
| [GSAP](https://gsap.com/) | 3.14 | Animations |
| [Lucide React](https://lucide.dev/) | 0.427 | Icon library |
| [clsx](https://github.com/lukeed/clsx) + [tailwind-merge](https://github.com/dcastil/tailwind-merge) | 2.1 / 2.5 | Conditional class utilities |

### Validation
| Library | Version | Purpose |
|---|---|---|
| [Zod](https://zod.dev/) | 3.23 | Schema validation |

### Deployment
| Tool | Purpose |
|---|---|
| Docker | Multi-stage containerized build |

---

## 📁 Project Structure

```
schedwhats/
├── app/
│   ├── api/
│   │   ├── connect/              # POST — Connect WhatsApp instance
│   │   ├── webhook/              # POST — Receive Evolution API events (vCard + text)
│   │   ├── health/               # GET  — System health check
│   │   ├── messages/             # GET / DELETE / PATCH — Manage scheduled messages
│   │   ├── cron/
│   │   │   └── send-messages/    # GET  — Cron job: send pending messages
│   │   └── payment/
│   │       ├── create-checkout/  # POST — Create Stripe checkout session
│   │       └── webhook/          # POST — Handle Stripe payment events
│   ├── dashboard/                # Main dashboard page
│   ├── login/                    # Login page
│   ├── signup/                   # Signup page
│   ├── payment/                  # Payment / upgrade page
│   ├── globals.css               # Global styles
│   ├── layout.tsx                # Root layout
│   └── page.tsx                  # Landing page
├── components/
│   ├── Button.tsx                # Reusable button with variants
│   ├── ConnectCard.tsx           # WhatsApp connection card
│   ├── Input.tsx                 # Styled input component
│   ├── QueueList.tsx             # Scheduled messages queue list
│   └── StatusBadge.tsx           # Message status badge
├── lib/
│   ├── evolution/                # Evolution API client
│   ├── openai/                   # OpenAI integration (legacy date parser)
│   ├── supabase/                 # Supabase client helpers
│   └── utils.ts                  # Shared utility functions
├── supabase/
│   └── schema.sql                # Full database schema with RLS
├── types/
│   ├── index.ts                  # Shared TypeScript types
│   └── supabase.ts               # Auto-generated Supabase types
├── public/                       # Static assets
├── middleware.ts                 # Next.js middleware (auth protection)
├── Dockerfile                    # Multi-stage Docker build
├── next.config.js
├── tailwind.config.ts
└── package.json
```

---

## 🔌 API Routes

### `POST /api/connect`

Connect a WhatsApp number via Evolution API. Creates or updates the instance.

**Request body:**
```json
{
  "phoneNumber": "+39123456789"
}
```

**Response:**
```json
{
  "instance": "SchedWhats-Primary",
  "qrCode": "data:image/png;base64,...",
  "pairingCode": "ABC-123"
}
```

---

### `POST /api/webhook`

Receives events from Evolution API. Handles two types of messages:

- **vCard messages** — stores the contact as a pending recipient.
- **Text messages** — parses Italian natural language commands and schedules messages.

Also handles queue management commands: `lista`, `annulla`, `cancella N`, `cancella <name>`, `aiuto`.

**Headers:** Evolution API sends the event payload automatically.

**Response:**
```json
{ "ok": true, "scheduled": "2025-01-25T08:00:00.000Z" }
```

---

### `GET /api/health`

System health check. Returns the status of the application and database.

**Response:**
```json
{ "status": "ok", "db": "connected", "timestamp": "2025-01-25T08:00:00.000Z" }
```

---

### `GET /api/messages?phone=39123456789`

Retrieve scheduled messages for a given phone number. Validates subscription status before returning data.

**Query params:**
| Param | Required | Description |
|---|---|---|
| `phone` | No | Filter by owner phone number |

**Response:**
```json
{
  "messages": [...],
  "subscription_status": "trial",
  "trial_ends_at": "2025-02-01T00:00:00.000Z"
}
```

---

### `DELETE /api/messages`

Delete a specific scheduled message by ID.

**Request body:**
```json
{ "id": "uuid", "phone": "39123456789" }
```

---

### `PATCH /api/messages`

Update the status of a scheduled message (e.g., cancel it). Sends a WhatsApp notification to the owner when a message is cancelled.

**Request body:**
```json
{ "id": "uuid", "status": "cancelled", "phone": "39123456789" }
```

---

### `GET /api/cron/send-messages?secret=<CRON_SECRET>`

Processes all pending scheduled messages that are due. Intended to be called by an external cron scheduler (e.g., every minute).

- Validates the `secret` query parameter against `CRON_SECRET`.
- Iterates all active/trial users and sends due messages via Evolution API.
- Applies in-memory rate limiting before each send.
- Retries failed messages up to 3 times with exponential backoff.
- Notifies the owner via WhatsApp on success or permanent failure.

**Response:**
```json
{
  "sent": 5,
  "failed": 1,
  "skipped": 0,
  "rateLimited": 2,
  "duration": "412ms",
  "timestamp": "2025-01-25T08:01:00.000Z"
}
```

---

### `POST /api/payment/create-checkout`

Creates a Stripe Checkout session for the Pro subscription (€1.99/month).

**Request body:**
```json
{ "phone": "39123456789", "email": "user@example.com" }
```

**Response:**
```json
{ "url": "https://checkout.stripe.com/pay/cs_live_..." }
```

---

### `POST /api/payment/webhook`

Receives Stripe webhook events. On `checkout.session.completed`:

1. Updates `user_instances.subscription_status` to `active`.
2. Inserts a record into the `subscriptions` table.
3. Sends a WhatsApp confirmation message to the user.

**Headers:** `stripe-signature` (verified with `STRIPE_WEBHOOK_SECRET`).

---

## 🗄️ Database Schema

### `user_instances`
Stores user records (identified by phone number, no Supabase Auth required for basic use).

| Column | Type | Description |
|---|---|---|
| `id` | UUID | Primary key |
| `phone_number` | TEXT | WhatsApp phone number (e.g., `39123456789`) |
| `instance_name` | TEXT | Evolution API instance name |
| `subscription_status` | TEXT | `trial` \| `active` \| `expired` |
| `trial_ends_at` | TIMESTAMPTZ | Trial expiry date (7 days from first use) |
| `subscription_id` | TEXT | Stripe subscription ID |
| `created_at` | TIMESTAMPTZ | Record creation date |

---

### `scheduled_messages`
Core table for all scheduled messages.

| Column | Type | Description |
|---|---|---|
| `id` | UUID | Primary key |
| `user_instance_id` | UUID | FK → `user_instances.id` |
| `instance_phone` | TEXT | Owner's phone number |
| `recipient_number` | TEXT | Recipient's phone number |
| `recipient_name` | TEXT | Recipient's display name |
| `caption` | TEXT | Original raw caption |
| `parsed_message` | TEXT | Message text after date extraction |
| `scheduled_at` | TIMESTAMPTZ | When to send the message |
| `status` | TEXT | `pending` \| `processing` \| `sent` \| `failed` \| `cancelled` |
| `sent_at` | TIMESTAMPTZ | Actual send time |
| `retry_count` | INTEGER | Number of retry attempts |
| `max_retries` | INTEGER | Maximum retries allowed (default: 3) |
| `error_message` | TEXT | Last error message if failed |
| `created_at` | TIMESTAMPTZ | Record creation date |

---

### `pending_contacts`
Temporary table for vCard recipients awaiting a scheduling command (30-minute TTL).

| Column | Type | Description |
|---|---|---|
| `owner_phone` | TEXT | Owner's phone number |
| `recipient_number` | TEXT | Recipient's phone number |
| `recipient_name` | TEXT | Recipient's display name |
| `created_at` | TIMESTAMPTZ | Insertion time (used for TTL check) |

---

### `subscriptions`
Stores Stripe subscription records linked to users.

| Column | Type | Description |
|---|---|---|
| `id` | UUID | Primary key |
| `stripe_customer_id` | TEXT | Stripe customer ID |
| `stripe_subscription_id` | TEXT | Stripe subscription ID |
| `status` | TEXT | `active` \| `cancelled` \| `past_due` |
| `current_period_end` | TIMESTAMPTZ | Subscription renewal date |
| `created_at` | TIMESTAMPTZ | Record creation date |

---

### `profiles`
User profile information linked to Supabase Auth.

| Column | Type | Description |
|---|---|---|
| `id` | UUID | FK → `auth.users.id` |
| `email` | TEXT | User email |
| `full_name` | TEXT | Display name |
| `phone_number` | TEXT | Phone number |
| `created_at` / `updated_at` | TIMESTAMPTZ | Timestamps |

---

### `whatsapp_instances`
Manages Evolution API WhatsApp connection state.

| Column | Type | Description |
|---|---|---|
| `id` | UUID | Primary key |
| `user_id` | UUID | FK → `profiles.id` |
| `instance_name` | TEXT | Evolution instance name |
| `status` | TEXT | `connected` \| `disconnected` \| `connecting` \| `error` |
| `qr_code` | TEXT | QR code data for pairing |
| `pairing_code` | TEXT | Numeric pairing code |
| `phone_number` | TEXT | Connected phone number |
| `connected_at` | TIMESTAMPTZ | Last connection time |

---

### `message_logs`
Audit trail for all message lifecycle events.

| Column | Type | Description |
|---|---|---|
| `id` | UUID | Primary key |
| `message_id` | UUID | FK → `scheduled_messages.id` |
| `user_id` | UUID | FK → `profiles.id` |
| `log_type` | TEXT | `created` \| `parsed` \| `scheduled` \| `sent` \| `failed` \| `retry` \| `cancelled` |
| `details` | JSONB | Arbitrary event details |
| `error_message` | TEXT | Error description if applicable |
| `created_at` | TIMESTAMPTZ | Event timestamp |

---

### `system_status`
Single-row table for health checks and maintenance mode.

| Column | Type | Description |
|---|---|---|
| `id` | INTEGER | Always `1` |
| `status` | TEXT | `active` \| `maintenance` \| `degraded` |
| `message` | TEXT | Status message |
| `updated_at` | TIMESTAMPTZ | Last update time |

---

## ⚙️ Environment Variables

### Supabase
```env
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_URL=https://xxxx.supabase.co          # Server-side (same as above)
SUPABASE_SERVICE_ROLE_KEY=eyJ...               # Service role key (never expose to client)
```

### Evolution API
```env
EVOLUTION_API_URL=https://your-evolution-api.com
EVOLUTION_API_KEY=your_evolution_api_key
```

### Stripe
```env
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

### Cron Job
```env
CRON_SECRET=your_secret_token    # Required to authorize cron job calls
```

### OpenAI (legacy)
```env
OPENAI_API_KEY=sk-...            # Used by the legacy OpenAI date parser
```

---

## 🚀 Setup & Installation

### Prerequisites

- Node.js 20+
- A [Supabase](https://supabase.com/) project
- An [Evolution API](https://evolution-api.com/) instance (self-hosted or cloud)
- A [Stripe](https://stripe.com/) account
- Docker (optional, for production deployment)

### 1. Clone & Install

```bash
git clone https://github.com/your-org/schedwhats.git
cd schedwhats
npm install
```

### 2. Configure Environment

```bash
cp .env.local.example .env.local
# Edit .env.local with your credentials
```

### 3. Set Up Database

1. Open your Supabase project → SQL Editor.
2. Copy the contents of `supabase/schema.sql`.
3. Run the SQL to create all tables, indexes, RLS policies, and triggers.

### 4. Generate TypeScript Types (optional)

```bash
SUPABASE_PROJECT_ID=your_project_id npm run db:types
```

### 5. Run Locally

```bash
npm run dev
# App available at http://localhost:3000
```

### 6. Docker Deployment

```bash
# Build image
docker build -t schedwhats:v7 .

# Run container
docker run -p 3000:3000 --env-file .env.local schedwhats:v7
```

### 7. Configure Cron Job

Set up an external scheduler (e.g., [cron-job.org](https://cron-job.org), Vercel Cron, or a system cron) to call:

```
GET https://your-app.com/api/cron/send-messages?secret=<CRON_SECRET>
```

Recommended interval: **every 1 minute**.

### 8. Configure Stripe Webhook

In the Stripe Dashboard, add a webhook endpoint:

```
https://your-app.com/api/payment/webhook
```

Subscribe to the event: `checkout.session.completed`.

### 9. Configure Evolution API Webhook

In your Evolution API instance, set the webhook URL to:

```
https://your-app.com/api/webhook
```

---

## 📝 Usage Flow

### Scheduling a Message

```
1. Open WhatsApp → "Note to Self" chat
2. Attach a contact (vCard) → send it
   └─ System stores the contact as the recipient (30-min window)
3. Send a text message with a date command:
   "domani alle 9 ciao Mario, come stai?"
   "fra 2 ore promemoria riunione"
   "il 25/12 alle 10 buon natale!"
   "alle 15:30 mandami il file"
4. Receive a WhatsApp confirmation:
   ✅ Programmato per 25 gen, 09:00 a Mario (39123456789).
   💬 "ciao Mario, come stai?"
   ⏳ Trial: 5g
5. At the scheduled time, the cron job sends the message automatically.
   ✅ Inviato a Mario!
```

### Queue Management Commands

Send these text messages to your "Note to Self":

| Command | Description |
|---|---|
| `lista` | Show all pending scheduled messages |
| `annulla` | Cancel the most recently added message (LIFO) |
| `cancella 2` | Cancel message #2 from the list |
| `cancella Marco` | Cancel the latest message to a recipient named "Marco" |
| `aiuto` | Show available commands |

### Supported Italian Date Patterns

| Expression | Meaning |
|---|---|
| `domani alle 9` | Tomorrow at 09:00 |
| `domani alle 14:30` | Tomorrow at 14:30 |
| `fra 5 minuti` | In 5 minutes |
| `fra 2 ore` | In 2 hours |
| `fra 3 giorni` | In 3 days |
| `alle 15:00` | Today at 15:00 (tomorrow if past) |
| `il 25/12 alle 10` | December 25th at 10:00 |
| `il 25/12/2025 alle 10` | December 25th 2025 at 10:00 |
| `fra due ore` | In 2 hours (written numbers supported) |
| `fra cinque minuti` | In 5 minutes (written numbers supported) |

All times are interpreted in the **Europe/Rome** timezone.

---

## 🔒 Security

### Row Level Security (RLS)
All Supabase tables have RLS enabled. Users can only read and write their own records.

### Stripe Webhook Verification
The `/api/payment/webhook` endpoint verifies every incoming event using the `stripe-signature` header and `STRIPE_WEBHOOK_SECRET`. Invalid signatures return a `400` response.

### Cron Job Authorization
The cron endpoint requires a `secret` query parameter matching `CRON_SECRET`. Unauthorized requests return a `401` response.

### Evolution API Authentication
All Evolution API calls include the `apikey` header. The key is stored server-side only.

### Rate Limiting (Anti-Spam)

The cron job enforces in-memory rate limits to prevent message flooding:

| Limit | Value |
|---|---|
| Per user per minute | 15 messages |
| Per user per day | 100 messages |
| Per instance per minute | 18 messages |
| Auto-block threshold | 50 messages/day |
| Auto-block on failures | 5 failed messages in 24h |

When a rate limit is hit, the message is rescheduled 2 minutes into the future. When a user is blocked, their messages are suspended until the next day.

### Anti-Burst Jitter
Each message send includes a random 2–4 second delay to prevent simultaneous bulk sending.

### Retry Logic
Failed messages are retried up to 3 times with exponential backoff (5 min, 10 min, 15 min). After 3 failures, the message is marked as `failed` and the owner is notified.

### Docker Security
The Dockerfile uses a non-root user in production.

---

## 🎨 Design System

| Token | Value | Description |
|---|---|---|
| Background | `#F3F5F7` | Very light gray/blue |
| Surface | `#FFFFFF` | Pure white |
| Primary | `#25D366` | WhatsApp green |
| Text Primary | `#111B21` | Dark charcoal |
| Text Secondary | `#667781` | Muted gray |
| Border Radius | `rounded-2xl` / `rounded-3xl` | Soft corners |
| Shadow | `shadow-[0_8px_30px_rgb(0,0,0,0.04)]` | Barely-there depth |
| Font | System font stack | `-apple-system, BlinkMacSystemFont, ...` |

---

## 🧩 UI Components

| Component | File | Description |
|---|---|---|
| **Button** | `components/Button.tsx` | Reusable button with primary, secondary, and ghost variants. Supports loading state. |
| **ConnectCard** | `components/ConnectCard.tsx` | Card UI for connecting a WhatsApp number. Displays QR code or pairing code. |
| **Input** | `components/Input.tsx` | Styled input field with label, error state, and icon support. |
| **QueueList** | `components/QueueList.tsx` | Live-updating list of scheduled messages. Supports cancel and status display. |
| **StatusBadge** | `components/StatusBadge.tsx` | Color-coded badge for message statuses: `pending`, `sent`, `failed`, `cancelled`. |

---

## 🤝 Contributing

This is a private repository. To contribute:

1. Create a feature branch from `main`.
2. Make your changes following the existing code style.
3. Run `npm run lint` and `npm run build` before opening a PR.
4. Open a pull request with a clear description of the change.

---

## 📄 License

MIT License — free to use for personal or commercial projects.

---

<div align="center">
  Built with ❤️ using Next.js, Supabase, and Evolution API.
</div>
