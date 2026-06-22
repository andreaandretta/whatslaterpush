-- H8: let cleanup-media skip media files still referenced by a LIVE row.
--
-- Recurring chains reuse the SAME media_url across every occurrence (the cron
-- copies media_url into each new pending row). So a >30-day-old terminal ('sent')
-- copy can share its storage file with a future PENDING occurrence — deleting it
-- would break the live chain forever (send-messages' createSignedUrl then throws
-- 'Failed to sign media URL' on every future send).
--
-- Returns the subset of p_paths still referenced by a LIVE row, so the cron can
-- exclude them from the Storage remove + the media_url nullify. "Live" = the same
-- explicit non-terminal status list the recurrence reconciliation uses for
-- has_live (positive list, not NOT-IN-terminal, so an unexpected status can never
-- be misread as in-use).
CREATE OR REPLACE FUNCTION public.recurring_media_in_use(p_paths text[])
RETURNS TABLE (media_url text)
LANGUAGE sql
STABLE
AS $$
  SELECT DISTINCT m.media_url
  FROM public.scheduled_messages m
  WHERE m.media_url = ANY(p_paths)
    AND m.status IN ('pending', 'processing', 'paused', 'awaiting_time', 'awaiting_recipient', 'awaiting_confirm');
$$;

-- Cron (service role) only.
REVOKE EXECUTE ON FUNCTION public.recurring_media_in_use(text[]) FROM PUBLIC, anon, authenticated;
