# Evolution p3 — build + test pairing post-cambio protocollo WhatsApp (18 ago 2026)

**Contesto.** Dal 28-29 lug 2026 WhatsApp manda `companion_reg_refresh` durante il
collegamento di un nuovo dispositivo; Baileys ≤ rc14 (e whatsmeow) lo scartano →
nessun `pair-success` → "impossibile collegare / codice errato" su OGNI nuovo
pairing, in tutto l'ecosistema (Baileys #2737/#2764, Evolution #2696). Le sessioni
già collegate continuano a funzionare. Fix upstream non ancora rilasciata; la
ricetta community-confermata è Baileys master + PR #2608 + #2749 + #2765.

**Immagine:** `whatslater/evo-patched:v2.3.7-p3` = Evolution v2.3.7 + Baileys
pinnato (master 0af2386 + le 3 PR) + strip p2 (historySyncConfig/version, ancora
presenti in rc14). Dockerfile: `deploy/evolution-patched/Dockerfile.p3` —
merge/build della libreria validati in locale il 18 ago (conflitto solo su un
file di test, risolto lato 2749).

## Procedura (terminal Coolify sul server Hetzner)

1. **Build** (~5-10 min): incollare il blocco "BUILD" (docker build via stdin,
   nessun checkout richiesto). Deve terminare con `p3 PATCH OK`.
2. **Stack di test** (porta 8081, Postgres effimero, API key generata al volo e
   stampata a video — comunicarla all'operatore/Claude): blocco "TEST STACK".
   Aprire la porta con `ufw allow 8081/tcp` (rimuoverla a test finito).
3. **Test pairing**: da fuori si crea l'istanza `wltest-p3` col numero di prova
   (526), si scansiona il QR / si inserisce il codice, si osserva
   `connectionState` → atteso `open` = protocollo riparato.
4. **Cleanup**: blocco "CLEANUP".

Se il test passa → backup Postgres Evolution di produzione (runbook Fase 6:
dump del DB) → swap del tag immagine nel compose della risorsa Coolify
(`whatslater/evo-patched:v2.3.7-p2` → `:v2.3.7-p3`) → redeploy → verificare che
599/739 tornino `open` → re-pair di 226 e 526 dal prodotto. Rollback = ripinnare
`:v2.3.7-p2` (le sessioni vivono nel Postgres, non nell'immagine).

## Blocchi comando

I blocchi esatti (BUILD / TEST STACK / CLEANUP) sono mantenuti nella sessione
operativa del 18 ago e riproducibili dal Dockerfile.p3; in sintesi:

- BUILD: `docker build -t whatslater/evo-patched:v2.3.7-p3 - < Dockerfile.p3`
- TEST STACK: rete `evo-p3-test`, `postgres:16-alpine` interno (senza porte
  host), container `evo-p3` su `-p 8081:8080` con env minime del compose prod e
  `AUTHENTICATION_API_KEY=$(openssl rand -hex 16)` stampata a video.
- CLEANUP: `docker rm -f evo-p3 evo-p3-pg && docker network rm evo-p3-test &&
  ufw delete allow 8081/tcp`

⚠️ Il container di PRODUZIONE (con 599/739) non va toccato finché il test non
passa. ⚠️ Repo pubblico: mai committare API key reali in questo file.
