-- Table: whatsapp_contacts
--
-- Caches contacts surfaced via Evolution webhook events (CONTACTS_SET,
-- CONTACTS_UPSERT, CONTACTS_UPDATE, MESSAGING_HISTORY_SET, MESSAGES_UPSERT).
-- Backs the cache-first read in GET /api/contacts.
CREATE TABLE IF NOT EXISTS whatsapp_contacts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_phone      TEXT NOT NULL,
  contact_number  TEXT NOT NULL,
  name            TEXT,
  push_name       TEXT,
  source          TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT whatsapp_contacts_user_contact_unique UNIQUE (user_phone, contact_number),
  CONSTRAINT whatsapp_contacts_source_check CHECK (source IN (
    'CONTACTS_SET',
    'CONTACTS_UPSERT',
    'CONTACTS_UPDATE',
    'MESSAGING_HISTORY_SET',
    'MESSAGES_UPSERT',
    'MANUAL'
  ))
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_contacts_user
  ON whatsapp_contacts (user_phone);

CREATE INDEX IF NOT EXISTS idx_whatsapp_contacts_user_name
  ON whatsapp_contacts (user_phone, name) WHERE name IS NOT NULL;

-- RLS: enable, but no policies. Intentional.
--
-- WhatsLater does NOT use Supabase Auth — sessions are HMAC cookies
-- (`sw_session`, see app/lib/auth-cookie.ts). All DB access goes through
-- the Next.js server with SUPABASE_SERVICE_ROLE_KEY, which bypasses RLS.
-- Authorization is enforced in app code (verifyCookie -> phone -> WHERE
-- user_phone = phone). The browser never holds the anon key and never
-- queries this table directly.
--
-- Adding `USING (auth.uid() = …)` would be a no-op because the request
-- has no Supabase JWT — auth.uid() returns null and the policy denies
-- everything anyway. We rely on the "RLS on + no policy = deny all" rule
-- for anon/authenticated roles, plus service-role bypass for our server.
--
-- This mirrors the pattern of pending_auth_sessions (20260419 migration).
ALTER TABLE whatsapp_contacts ENABLE ROW LEVEL SECURITY;

-- Function: upsert_whatsapp_contacts(p_rows JSONB) -> INTEGER
--
-- Batch-upserts contact rows with merge semantics that protect against
-- the known Evolution bug #2426 (outgoing messages can deliver
-- name=null/push_name=null events that would otherwise wipe a previously
-- captured name). Behavior:
--
--   * name      -> COALESCE(new, existing)  -- null never overwrites real
--   * push_name -> COALESCE(new, existing)  -- null never overwrites real
--   * source    -> updated ONLY if name or push_name actually changed
--   * updated_at-> updated ONLY if name or push_name actually changed
--
-- Atomic in a single roundtrip. Caller is service_role, so no
-- SECURITY DEFINER is needed (would only widen the escalation surface).
-- Returns the row-count touched by the INSERT/ON CONFLICT for logging.
CREATE OR REPLACE FUNCTION upsert_whatsapp_contacts(p_rows JSONB)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  rows_count INTEGER;
BEGIN
  INSERT INTO whatsapp_contacts (user_phone, contact_number, name, push_name, source, updated_at)
  SELECT
    (r->>'user_phone')::TEXT,
    (r->>'contact_number')::TEXT,
    NULLIF(r->>'name', ''),
    NULLIF(r->>'push_name', ''),
    (r->>'source')::TEXT,
    NOW()
  FROM jsonb_array_elements(p_rows) r
  ON CONFLICT (user_phone, contact_number) DO UPDATE
  SET
    name      = COALESCE(EXCLUDED.name,      whatsapp_contacts.name),
    push_name = COALESCE(EXCLUDED.push_name, whatsapp_contacts.push_name),
    source = CASE
      WHEN (EXCLUDED.name      IS NOT NULL AND EXCLUDED.name      IS DISTINCT FROM whatsapp_contacts.name)
        OR (EXCLUDED.push_name IS NOT NULL AND EXCLUDED.push_name IS DISTINCT FROM whatsapp_contacts.push_name)
      THEN EXCLUDED.source
      ELSE whatsapp_contacts.source
    END,
    updated_at = CASE
      WHEN (EXCLUDED.name      IS NOT NULL AND EXCLUDED.name      IS DISTINCT FROM whatsapp_contacts.name)
        OR (EXCLUDED.push_name IS NOT NULL AND EXCLUDED.push_name IS DISTINCT FROM whatsapp_contacts.push_name)
      THEN NOW()
      ELSE whatsapp_contacts.updated_at
    END;
  GET DIAGNOSTICS rows_count = ROW_COUNT;
  RETURN rows_count;
END;
$$;
