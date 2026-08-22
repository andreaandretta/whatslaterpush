-- Google Calendar sync (v1, stile WA Reminders): connessione read-only per
-- utente. Un cron ~15min scansiona gli eventi imminenti (now → +14gg) del
-- calendario collegato; gli eventi che contengono un numero di telefono
-- generano un reminder WhatsApp auto-schedulato nella pipeline ESISTENTE
-- scheduled_messages, idempotente per evento (calendar_event_key).
-- Il refresh token Google è cifrato AES-256-GCM (CALENDAR_TOKEN_SECRET),
-- mai in chiaro a riposo.

create table if not exists public.calendar_connections (
  id uuid primary key default gen_random_uuid(),
  user_phone text not null unique,
  google_refresh_token_enc text not null,
  google_email text,
  calendar_id text not null default 'primary',
  reminder_offset_minutes int not null default 60,
  message_template text,
  enabled boolean not null default true,
  last_synced_at timestamptz,
  last_sync_error text,
  created_at timestamptz not null default now()
);

-- Stessa postura di host_metrics (20260706_host_metrics): RLS ON senza policy
-- = accesso solo via service-role; una anon key leakkata non legge né scrive
-- nulla (qui dentro c'è un refresh token Google, pur se cifrato).
alter table public.calendar_connections enable row level security;

-- Idempotenza per evento: calendar_event_key = <connection.id>:<event.id>
-- (singleEvents=true espande le ricorrenze in istanze con id univoci).
-- Unique parziale: le righe non-calendar (key NULL) restano fuori dal vincolo.
alter table public.scheduled_messages
  add column if not exists calendar_event_key text;

create unique index if not exists scheduled_messages_calendar_event_key_uq
  on public.scheduled_messages (calendar_event_key)
  where calendar_event_key is not null;
