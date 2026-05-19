-- Add added_manually flag to whatsapp_contacts.
--
-- Background: the ContactPickerModal currently uses `name.startsWith('+')` as
-- a proxy filter to hide cache rows that have no real display name (just a
-- "+digits" placeholder). The proxy was correct when push_name coverage was
-- ~7% (Strada A pre-launch) — after Strada A, push_name coverage is ~100% so
-- the filter is functionally a no-op, but it's still semantically fragile:
-- any future row whose name happens to start with "+" (e.g. a contact named
-- "+39 Anna" written that way in someone's address book) would silently
-- disappear.
--
-- This migration adds a boolean `added_manually` defaulting to FALSE. Rows
-- inserted via QuickCaptureModal (manual contact entry) will set this to
-- TRUE; rows ingested by the webhook upsert RPC leave it FALSE. The picker
-- filter can then read it as semantic truth:
--
--   include row IF (push_name IS NOT NULL AND push_name <> '')
--                OR added_manually = TRUE
--
-- The webhook upsert RPC (upsert_whatsapp_contacts) does NOT need to be
-- redefined: it does not touch added_manually, so when CONTACTS_UPSERT
-- arrives later for a manually-added number the column stays TRUE thanks to
-- the existing INSERT ... ON CONFLICT semantics (the SET clause leaves
-- non-mentioned columns alone).

ALTER TABLE whatsapp_contacts
  ADD COLUMN IF NOT EXISTS added_manually BOOLEAN NOT NULL DEFAULT FALSE;
