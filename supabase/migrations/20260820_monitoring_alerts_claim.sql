-- Task 55 (backlog #9): dedup atomico degli alert di monitoring.
--
-- /api/monitoring/health-check gira concorrente (Vercel cron + pg_cron/self-cron,
-- entrambi */15): due run possono leggere previousStatus=ok e inviare DUE volte
-- lo stesso alert di onset. Stessa classe del doppio-invio messaggi (BUG #1):
-- read-then-write non atomico.
--
-- Fix: claim-before-send. Prima di inviare, il run INSERISCE una riga di claim
-- con minute_bucket = floor(epoch/60): l'indice unico sotto fa vincere il claim
-- a UN solo run; l'altro riceve 23505 e non invia. Le righe di log normali
-- (canale whatsapp/email/db_only) hanno minute_bucket NULL e non confliggono.

ALTER TABLE monitoring_alerts ADD COLUMN IF NOT EXISTS minute_bucket bigint;

CREATE UNIQUE INDEX IF NOT EXISTS monitoring_alerts_claim_uniq
  ON monitoring_alerts (check_name, minute_bucket)
  WHERE minute_bucket IS NOT NULL;

COMMENT ON COLUMN monitoring_alerts.minute_bucket IS
  'Claim atomico anti-alert-doppi (Task 55/#9): floor(epoch/60) sulla riga di claim, NULL sulle righe di log canale. Unique parziale su (check_name, minute_bucket).';
