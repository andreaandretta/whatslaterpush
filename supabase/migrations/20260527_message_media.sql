-- Migration: message_media
-- Adds media support to scheduled_messages. Each row can now carry image,
-- video, document, audio, sticker, location, or contact payload alongside
-- the existing text body (which becomes the optional caption).
-- Date: 2026-05-27
--
-- Storage: files live in Supabase Storage bucket `message-media`, private
-- (service-role only). Naming convention: {user_phone}/{uuid}-{original_filename}
-- Bucket must be created via Supabase dashboard or `storage.create_bucket`
-- call before /api/messages/upload can succeed. The bucket is intentionally
-- NOT created here (storage RLS lives in a different namespace and is fragile
-- via migration files).

alter table public.scheduled_messages
  add column if not exists media_type text
    check (media_type in ('image', 'video', 'document', 'audio', 'sticker', 'location', 'contact')),
  add column if not exists media_url text,
  add column if not exists media_filename text,
  add column if not exists media_caption text;

-- For cron to quickly distinguish text-only from media sends without
-- pulling the URL string.
create index if not exists idx_scheduled_messages_media_type
  on public.scheduled_messages(media_type)
  where media_type is not null;
