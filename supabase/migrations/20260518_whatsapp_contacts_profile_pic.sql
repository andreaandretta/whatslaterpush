-- Add profile picture URL caching to whatsapp_contacts.
--
-- Background: avatars in ContactPickerModal previously triggered one
-- /chat/fetchProfile call per visible contact, which saturated Evolution
-- (502s) and forced us to disable photos entirely. Baileys already exposes
-- `profilePicUrl` in CONTACTS_SET / CONTACTS_UPSERT / CONTACTS_UPDATE
-- webhook payloads (and in /chat/findContacts + /chat/findChats bulk
-- responses) — we just weren't capturing it. This migration adds the column
-- and teaches the upsert RPC to merge it with the same null-preserving
-- semantics as `name` and `push_name`.

ALTER TABLE whatsapp_contacts
  ADD COLUMN IF NOT EXISTS profile_pic_url TEXT;

-- Replace the RPC with the same body but extended to handle profile_pic_url.
-- Merge rule mirrors name/push_name: COALESCE(new, existing) so a later event
-- carrying null never wipes a URL captured earlier. The source/updated_at
-- bump now also fires when the URL itself changes — useful so we can tell
-- "fresh photo from WhatsApp" from "stale row".
CREATE OR REPLACE FUNCTION upsert_whatsapp_contacts(p_rows JSONB)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  rows_count INTEGER;
BEGIN
  INSERT INTO whatsapp_contacts (user_phone, contact_number, name, push_name, profile_pic_url, source, updated_at)
  SELECT
    (r->>'user_phone')::TEXT,
    (r->>'contact_number')::TEXT,
    NULLIF(r->>'name', ''),
    NULLIF(r->>'push_name', ''),
    NULLIF(r->>'profile_pic_url', ''),
    (r->>'source')::TEXT,
    NOW()
  FROM jsonb_array_elements(p_rows) r
  ON CONFLICT (user_phone, contact_number) DO UPDATE
  SET
    name            = COALESCE(EXCLUDED.name,            whatsapp_contacts.name),
    push_name       = COALESCE(EXCLUDED.push_name,       whatsapp_contacts.push_name),
    profile_pic_url = COALESCE(EXCLUDED.profile_pic_url, whatsapp_contacts.profile_pic_url),
    source = CASE
      WHEN (EXCLUDED.name            IS NOT NULL AND EXCLUDED.name            IS DISTINCT FROM whatsapp_contacts.name)
        OR (EXCLUDED.push_name       IS NOT NULL AND EXCLUDED.push_name       IS DISTINCT FROM whatsapp_contacts.push_name)
        OR (EXCLUDED.profile_pic_url IS NOT NULL AND EXCLUDED.profile_pic_url IS DISTINCT FROM whatsapp_contacts.profile_pic_url)
      THEN EXCLUDED.source
      ELSE whatsapp_contacts.source
    END,
    updated_at = CASE
      WHEN (EXCLUDED.name            IS NOT NULL AND EXCLUDED.name            IS DISTINCT FROM whatsapp_contacts.name)
        OR (EXCLUDED.push_name       IS NOT NULL AND EXCLUDED.push_name       IS DISTINCT FROM whatsapp_contacts.push_name)
        OR (EXCLUDED.profile_pic_url IS NOT NULL AND EXCLUDED.profile_pic_url IS DISTINCT FROM whatsapp_contacts.profile_pic_url)
      THEN NOW()
      ELSE whatsapp_contacts.updated_at
    END;
  GET DIAGNOSTICS rows_count = ROW_COUNT;
  RETURN rows_count;
END;
$$;
