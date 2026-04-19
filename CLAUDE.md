# WhatsLater (SchedWhats) — Project Context

## STATO ATTUALE (aggiornato 19 Marzo 2026):
- ✅ 88 test automatici tutti verdi
- ✅ Self-chat check: solo messaggi a se stessi processati
- ✅ Gruppi e broadcast bloccati
- ✅ Atomic lock cron: nessun double-send
- ✅ WEBHOOK_SECRET obbligatorio
- ✅ Timeout 8s su Evolution API
- ✅ Date passate rifiutate
- ✅ Stripe configurato (sandbox mode)
- ✅ Tier system: Free/Personal/Business/Trial
- ✅ Privacy Policy e ToS live
- ✅ C1 (autenticazione phone-first cookie firmato HMAC, sessione 90gg sliding)
- ⚠️ Stripe live mode — in attesa verifica account
- 📌 CRON_SECRET ruotato — aggiornare cron-job.org con nuovo URL

## Auth (post-C1)
- Cookie HTTP-only `sw_session` HMAC-SHA256 (env: `AUTH_COOKIE_SECRET`, generated with `openssl rand -hex 64`)
- Sessione emessa al CONNECTION_UPDATE state=open via `/api/auth/check`
- Tabella `pending_auth_sessions` per coordinazione browser↔webhook
- Multi-device richiede re-pair (limitazione v1, OTP self-chat in v1.5)
- Implementazione usa Web Crypto API (compatible Edge runtime + Node)
