-- Migration: add 'MANUAL_CSV' to whatsapp_contacts.source CHECK constraint
-- Date: 2026-05-27
--
-- The new POST /api/contacts/import endpoint inserts rows with
-- source='MANUAL_CSV' so we can distinguish CSV-imported contacts from
-- single-row "Nuovo contatto" manual entries (MANUAL) in analytics and
-- back-office triage.

alter table public.whatsapp_contacts
  drop constraint if exists whatsapp_contacts_source_check;

alter table public.whatsapp_contacts
  add constraint whatsapp_contacts_source_check check (source in (
    'CONTACTS_SET',
    'CONTACTS_UPSERT',
    'CONTACTS_UPDATE',
    'MESSAGING_HISTORY_SET',
    'MESSAGES_UPSERT',
    'MANUAL',
    'MANUAL_CSV'
  ));
