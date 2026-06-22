-- H6: GDPR right-to-be-forgotten — transactional account cascade.
--
-- Replaces the route's per-table DELETE loop (non-atomic: a mid-cascade failure
-- left a half-deleted user) with a single function whose body runs in one
-- transaction -> all-or-nothing (#58). Also closes #30: audit_events were pruned
-- only by user_phone, but instance_disconnect + pairing rows are written
-- user_phone=null, keyed by the instance, and carry the user's IP (inet) — those
-- now go too. (Storage media purge is #29 and lives in the route — it can't be
-- inside a DB transaction.)
--
-- The route still resolves instance_name first and writes the account_deleted
-- forensic event AFTER this function (so it survives the prune).

CREATE OR REPLACE FUNCTION public.delete_user_account(p_phone text, p_instance_name text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  -- Single transaction (function body) -> atomic. Any failure rolls back the lot.
  DELETE FROM public.scheduled_messages        WHERE instance_phone = p_phone;
  DELETE FROM public.whatsapp_contacts         WHERE user_phone     = p_phone;
  DELETE FROM public.user_templates            WHERE user_phone     = p_phone;
  DELETE FROM public.contact_label_assignments WHERE user_phone     = p_phone;
  DELETE FROM public.contact_labels            WHERE user_phone     = p_phone;
  DELETE FROM public.pending_contacts          WHERE owner_phone    = p_phone;
  DELETE FROM public.pending_auth_sessions     WHERE phone          = p_phone;
  DELETE FROM public.rate_limit_state          WHERE key IN ('user:' || p_phone, 'inst:' || p_instance_name);

  -- #30: prune by user_phone AND by the instance-keyed, IP-bearing rows that the
  -- old user_phone-only prune missed (instance_disconnect, pairing_*).
  DELETE FROM public.audit_events
    WHERE user_phone = p_phone
       OR payload->>'instance'      = p_instance_name
       OR payload->>'instance_name' = p_instance_name;

  -- user_instances LAST (keeps the auth gate evaluable if anything above raised).
  DELETE FROM public.user_instances WHERE phone_number = p_phone;
END;
$$;

-- Service role (the delete route) only; never anon/authenticated.
REVOKE EXECUTE ON FUNCTION public.delete_user_account(text, text) FROM PUBLIC, anon, authenticated;
