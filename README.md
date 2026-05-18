# WhatsLater

A modern WhatsApp message scheduler SaaS built with Next.js 14, Supabase, and Evolution API.

![Version](https://img.shields.io/badge/version-7.0.0-green.svg)
![Next.js](https://img.shields.io/badge/Next.js-14-black.svg)
![License](https://img.shields.io/badge/license-MIT-blue.svg)

## ✨ Features

- **Dashboard-first Scheduling** - Pick a contact, write the message, choose the time
- **Natural Language Time Parsing** - "Tomorrow at 9am" works in the date picker
- **Modern Soft UI** - Clean, airy design with rounded corners and soft shadows
- **Real-time Updates** - Live message queue with Supabase subscriptions
- **Secure** - Row Level Security, encrypted connections
- **Smart Jitter** - Random delays prevent message flooding

## 🎨 Design System

- **Background**: `#F3F5F7` - Very light gray/blue
- **Surface**: `#FFFFFF` - Pure white
- **Primary**: `#25D366` - WhatsApp green
- **Text Primary**: `#111B21` - Dark gray
- **Text Secondary**: `#667781` - Light gray
- **Radius**: `rounded-2xl` or `rounded-3xl`
- **Shadows**: `shadow-[0_8px_30px_rgb(0,0,0,0.04)]`

## 🚀 Quick Start

### Prerequisites

- Node.js 20+
- Docker (optional)
- Supabase account
- Evolution API instance
- OpenAI API key

### Environment Setup

```bash
cp .env.local.example .env.local
```

Fill in your credentials:

```env
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

EVOLUTION_API_URL=https://your-evolution-api.com
EVOLUTION_API_KEY=your_evolution_api_key

OPENAI_API_KEY=sk-your_openai_key
```

### Database Setup

1. Go to Supabase SQL Editor
2. Copy contents of `supabase/schema.sql`
3. Run the SQL

### Local Development

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Open http://localhost:3000
```

### Docker Deployment

```bash
# Build image
docker build -t schedwhats:v7 .

# Run container
docker run -p 3000:3000 --env-file .env.local schedwhats:v7
```

## 📁 Project Structure

```
schedwhats/
├── app/
│   ├── api/
│   │   ├── connect/      # WhatsApp connection endpoint
│   │   ├── webhook/      # Evolution API webhook
│   │   └── health/       # Health check endpoint
│   ├── dashboard/        # Main dashboard UI
│   ├── connect/          # Phone pairing (primary entry)
│   ├── login/            # Login page (returning users)
│   ├── globals.css       # Global styles
│   ├── layout.tsx        # Root layout
│   └── page.tsx          # Landing page
├── components/           # Reusable UI components
├── lib/
│   ├── evolution/        # Evolution API client
│   ├── openai/           # OpenAI date parser
│   ├── supabase/         # Supabase clients
│   └── utils.ts          # Utility functions
├── supabase/
│   └── schema.sql        # Database schema
├── types/                # TypeScript types
├── Dockerfile            # Multi-stage Docker build
└── package.json
```

## 🔌 API Routes

### POST `/api/connect`

Connect WhatsApp instance using Evolution API.

```json
{
  "phoneNumber": "+1234567890"
}
```

### POST `/api/webhook`

Receive WhatsApp message events from Evolution API.

### GET `/api/health`

System health check.

## 📝 Usage Flow

1. **Connect** your WhatsApp via pairing code at `/connect`
2. **Open the dashboard** at `/dashboard`
3. **Pick a contact** from your synced contacts
4. **Write the message** and choose when to send it
5. **Message sent** at the scheduled time, from your number

## 🔒 Security

- Row Level Security (RLS) on all tables
- API key authentication for Evolution
- Webhook token verification
- Supabase Auth with email verification
- Non-root Docker user

## 🛠️ Tech Stack

- **Framework**: Next.js 14 (App Router)
- **Styling**: Tailwind CSS
- **Database**: Supabase (PostgreSQL)
- **Auth**: Supabase Auth
- **WhatsApp**: Evolution API v2
- **AI**: OpenAI GPT-4o Mini
- **Deployment**: Docker Standalone

## 📄 License

MIT License - feel free to use for personal or commercial projects.

---

Built with ❤️ using Modern Soft UI principles.

<!-- cron: hourly via vercel.json -->
