-- Migration: message_delivery_status
-- Tracks WhatsApp delivery + read receipts (the ✓ → ✓✓ → ✓✓ blue progression
-- the user expects in WhatsApp UI). evolution_message_id is the key.id field
-- returned by Evolution's /message/sendText response and reused as the match
-- key when Evolution forwards messages.update events back to our webhook.
-- Date: 2026-05-27

alter table public.scheduled_messages
  add column if not exists delivered_at timestamptz,
  add column if not exists read_at timestamptz,
  add column if not exists evolution_message_id text;

-- Webhook handler does WHERE evolution_message_id = X on every messages.update
-- event from Evolution. Partial index keeps it cheap.
create index if not exists idx_scheduled_messages_evolution_id
  on public.scheduled_messages(evolution_message_id)
  where evolution_message_id is not null;
