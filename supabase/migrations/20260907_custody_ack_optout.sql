-- Migration: custody ack + opt-out del destinatario (anti-ban, 7 set 2026)
--
-- DA APPLICARE SOLO CON L'OK DI ANDREA. Il codice che usa queste colonne è
-- dietro i flag CUSTODY_ACK_ENABLED / OPT_OUT_ENABLED (Vercel env) e resta
-- spento finché la migration non è in produzione.
--
-- 1) scheduled_messages.server_ack_at  — SERVER_ACK(2) dal webhook: "WhatsApp
--    ha preso in carico il messaggio" (oggi 'sent' = scritto sul socket).
-- 2) scheduled_messages.ack_error_at   — ERROR(0) dopo l'invio: WhatsApp lo ha
--    rifiutato (numero che ha bloccato, non attivo, ecc.).
-- 3) whatsapp_contacts.last_inbound_at — SOLO la data dell'ultimo messaggio
--    ricevuto da quel numero (mai il contenuto): prova che esiste una chat.
-- 4) recipient_suppressions            — destinatari a cui NON scrivere più:
--    opt_out (hanno scritto "stop"), ack_error (3 rifiuti in 7 giorni), manual.

alter table public.scheduled_messages
  add column if not exists server_ack_at timestamptz,
  add column if not exists ack_error_at timestamptz;

create index if not exists idx_scheduled_messages_ack_error
  on public.scheduled_messages (instance_phone, recipient_number, ack_error_at)
  where ack_error_at is not null;

alter table public.whatsapp_contacts
  add column if not exists last_inbound_at timestamptz;

create table if not exists public.recipient_suppressions (
  owner_phone       text not null,
  recipient_number  text not null,
  reason            text not null check (reason in ('opt_out', 'ack_error', 'manual')),
  created_at        timestamptz not null default now(),
  primary key (owner_phone, recipient_number)
);

-- RLS on, nessuna policy: come le altre tabelle, l'accesso passa SOLO dal
-- server Next.js con la service-role key (vedi 20260517_whatsapp_contacts.sql).
alter table public.recipient_suppressions enable row level security;
