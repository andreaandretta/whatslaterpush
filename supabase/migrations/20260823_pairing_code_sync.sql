-- Sync del pairing code in /connect (incidente "terno al lotto" 23 ago):
-- Evolution rigenera il codice ~ogni 45s (QRCODE_UPDATED) ma la UI mostrava
-- lo stesso codice per 10 minuti. Il webhook ora salva il codice corrente
-- sulla pending session; /api/auth/check lo restituisce al poll della pagina.
-- conn_state ('connecting'|'open'|'close') alimenta il feedback di stato.

alter table public.pending_auth_sessions
  add column if not exists pairing_code text,
  add column if not exists pairing_code_updated_at timestamptz,
  add column if not exists conn_state text;
