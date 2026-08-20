# RUNBOOK — Pairing rotto / "codice errato" / onboarding che fallisce

Distillato dall'incidente 17-19 ago 2026 (3 giorni di diagnosi). Seguendo
quest'albero la stessa diagnosi si chiude in ~30 minuti. Parti dall'alert
(`pairing_blackout`): il campo **"Ultimo errore"** nel messaggio indirizza già
il ramo giusto.

## 0. Prima di tutto: NON martellare

Ogni tentativo di pairing fallito e ripetuto **consuma il rate-limit Meta del
numero** (per-numero, non per-server). 5-7 tentativi ravvicinati = numero in
castigo ore/giorni ("impossibile collegare in questo momento, riprova più
tardi"). La UI ha il freno (Task 58), ma se stai testando a mano via API vale
lo stesso: **max 1-2 tentativi, poi fermati a ragionare.**

## 1. L'istanza esiste sul nodo? In che stato?

```bash
# stato DB (row) — fetchInstances
curl -s -H "apikey: $EVOLUTION_API_KEY" "$EVOLUTION_API_URL/instance/fetchInstances" \
  | jq -r '.[] | [.name, .connectionStatus, .createdAt, .updatedAt] | @tsv'

# stato IN-MEMORY (socket) — può divergere dal DB!
curl -s -H "apikey: $EVOLUTION_API_KEY" "$EVOLUTION_API_URL/instance/connectionState/SchedWhats-<numero>"
```

| Sintomo | Diagnosi | Cura |
|---|---|---|
| DB `open` ma in-memory `connecting` da ore | **ZOMBIE** (socket rotto in retry perpetuo) | Il teardown verificato di init lo gestisce (restart→delete); se persiste: `docker restart` del container Evolution (registry ricostruito dal DB al boot) |
| Istanza non si cancella (logout 500 "Connection Closed", delete 400) | Zombie inamovibile via API | Come sopra: restart container, poi delete |
| `createdAt` NON cambia dopo un tentativo di pairing | La create è fallita (name-in-use) e QUALCOSA ha mostrato un codice morto | Verifica che il fix "teardown verificato + fail-fast" (commit `6718b3c`) sia deployato |

## 2. Il codice/QR viene generato ma il telefono rifiuta

| Messaggio sul telefono | Significato | Cura |
|---|---|---|
| "Impossibile collegare **in questo momento**, riprova più tardi" | **Rate-limit Meta sul numero** (troppi tentativi) | Aspetta 24-48h SENZA riprovare, oppure testa con un numero mai usato |
| "Codice errato" / "verifica il numero" | Codice morto (istanza zombie) O protocollo rotto | Segui il punto 1; se l'istanza è sana e fresca → punto 3 |
| "Impossibile collegare **dispositivi nuovi**" + prompt passkey su WhatsApp Web ufficiale | Account passkey-gated (Baileys non supporta la ceremony) | Rimuovi la passkey: WhatsApp → Impostazioni → Account → Passkey |
| Accetta il codice, poi "errore di collegamento" e Evolution logga **401 loggedOut** ~3 min dopo | **Registrazione rifiutata = protocollo** (classe giugno/luglio 2026) | Punto 3 |

## 3. Protocollo WhatsApp cambiato (il "muro")

Sintomi: numeri DIVERSI e freschi falliscono tutti; le sessioni GIÀ collegate
continuano a funzionare; issue coeve su GitHub (Baileys + Evolution + whatsmeow
rotti insieme = cambio server-side Meta).

1. Controlla le issue recenti: `WhiskeySockets/Baileys`, `evolution-foundation/evolution-api`
   (la sentinella `upstream-watch` manda l'email quando esce una release nuova).
2. **Scialuppa pronta**: immagine `whatslater/evo-patched:v2.3.7-p3`
   (Baileys pinnato + fix protocollo — `deploy/evolution-patched/Dockerfile.p3`,
   build/test in `docs/2026-08-18-evolution-p3-build-test.md`).
3. Valida su container di test con **un numero pulito** (mai usato per pairing
   bot): create → QR in ASCII nel terminal → scan → `connectionState` = `open`.
4. Solo a test verde: backup Postgres Evolution (runbook Fase 6) → swap tag nel
   compose Coolify → redeploy → verifica che gli utenti esistenti tornino `open`.
   Rollback = ripinnare il tag precedente (le sessioni vivono nel DB, non nell'immagine).

## 4. Checklist post-deploy (auth/pairing/webhook) — il canarino

Dopo OGNI deploy che tocca `auth/init`, `webhook`, `middleware`, `lib/evolution`:

- [ ] Pairing di prova col **numero canarino** (SIM dedicata SOLO a questo) → collegato
- [ ] La rubrica si popola nel ContactPicker (gate full-sync)
- [ ] Messaggio di prova programmato → consegnato
- [ ] Scollega il canarino (pronto per il prossimo test)

⚠️ Max 1-2 pairing/settimana col canarino — troppi insospettiscono Meta.
⚠️ MAI usare i numeri degli utenti reali collegati per i test (rischio caduta sessione).

## Riferimenti

- Fix strutturali (18 ago): teardown verificato `6718b3c`, catch-22 re-pair `9cd0ffb`
- Alert: `pairing_blackout` critical già a 2 tentativi falliti/24h, con "Ultimo errore" reale (Task 54)
- Storia completa: memoria di sessione `project_evolution_v237_pairing_gotchas`
