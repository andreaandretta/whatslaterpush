-- paired_at: istante del PRIMO CONNECTION_UPDATE state=open dell'account
-- (timbrato dal webhook con guardia is-null: una sola volta, mai sovrascritto).
--
-- È il discriminatore del guard anti-hijack #8 in /api/auth/init: una riga
-- SENZA paired_at è un onboarding mai completato (la lascia l'upsert di un
-- tentativo interrotto) e può essere re-inizializzata senza cookie; una riga
-- CON paired_at è un account reale → re-init owner-only. Prima di questa
-- colonna il guard scattava su qualsiasi riga esistente: il primo retry di un
-- numero vergine moriva 409 "questo numero ha già un account" (bug 2026-08-18,
-- catch-22 col middleware che rimbalzava /connect per i loggati).
--
-- Backfill: ogni riga presente al momento della migration è un account storico
-- realmente accoppiato (le righe garbage note sono state rimosse a mano il
-- 17-18 ago) → paired_at = updated_at, così restano tutte owner-only.

ALTER TABLE user_instances ADD COLUMN IF NOT EXISTS paired_at timestamptz;

UPDATE user_instances SET paired_at = updated_at WHERE paired_at IS NULL;

COMMENT ON COLUMN user_instances.paired_at IS
  'Primo CONNECTION_UPDATE open (webhook, timbro una tantum). NULL = onboarding mai completato: il guard #8 di /api/auth/init non scatta e i rami di errore possono cancellare la riga.';
