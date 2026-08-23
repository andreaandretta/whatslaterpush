# Runbook — Recovery re-pair da browser nuovo (post fix #8)

## Contesto
Il fix #8 (hijack account) rende `/api/auth/init` **owner-only per ogni numero con account esistente**: se un numero ha già una riga in `user_instances` (in qualsiasi stato: open/close/connecting), solo chi ha un cookie `sw_session` valido per quel numero — cioè lo stesso browser dove è già loggato — può ri-collegarlo. Ogni altra richiesta riceve **409** con messaggio:

> *"Questo numero ha già un account. Aprilo dallo stesso browser dove sei già loggato, oppure contatta il supporto per recuperare l'accesso."*

Questo chiude il vettore di hijack (un estraneo che inietta una pending session per il numero della vittima durante un flap), al prezzo di **bloccare il re-pair legittimo da un browser NUOVO** (device/browser perso, nessun cookie). Recupero = procedura manuale operatore qui sotto. *(OTP self-chat v1.5, già previsto, lo renderà self-service.)*

## Quando serve
Un utente legittimo scrive che non riesce a ri-collegare il suo numero (ha perso il device o cambiato browser) e riceve il 409 "ha già un account".

## Procedura (operatore)
1. **Verifica identità** — accertati che chi chiede sia davvero il proprietario del numero (es. rispondendo da quel numero WhatsApp, o altra prova concordata). NON procedere senza verifica: questo passo è l'unico gate rimasto contro l'hijack.
2. **Resetta l'account del numero** — così il numero torna "nuovo" e il re-pair procede senza cookie. Via Supabase SQL editor (progetto `inheoexhtuyjtfotbzyw`), sostituendo `<PHONE>` col numero in formato E.164 senza `+` (es. `393331234567`):
   ```sql
   -- Censimento prima (conferma di agire sulla riga giusta)
   select phone_number, subscription_plan, connection_status, trial_ends_at
   from user_instances where phone_number = '<PHONE>';

   -- ⚠️ PRIMA il delete nudo FALLISCE con FK 23503: scheduled_messages ha la
   -- FK user_instance_id → user_instances (verificato 23 ago). Sgancia i
   -- messaggi (restano intatti, ancorati a instance_phone) e poi cancella:
   with target as (select id from user_instances where phone_number = '<PHONE>')
   update scheduled_messages set user_instance_id = null
   where user_instance_id in (select id from target);

   delete from user_instances where phone_number = '<PHONE>';
   ```
   ⚠️ Senza `user_instances` il piano/trial si resetta al re-pair (nuovo trial 7gg). Un UPDATE del solo `connection_status` NON basta (il guard morde su qualsiasi riga esistente) — la strada pulita per la beta è il delete + eventuale ripristino manuale del piano post-repair.
3. **L'utente ri-collega** — apre `/connect`, inserisce il numero, inserisce il pairing code sul telefono. Ora `/api/auth/init` non trova la riga → procede → pairing normale → nuovo cookie 90gg.
4. **Backfill dei messaggi** — ri-aggancia lo storico/coda al NUOVO account (eseguito con successo il 23 ago, 63 righe):
   ```sql
   update scheduled_messages sm
   set user_instance_id = ui.id
   from user_instances ui
   where ui.phone_number = sm.instance_phone
     and sm.user_instance_id is null
     and ui.phone_number = '<PHONE>';
   ```
5. **(Se serve) ripristina il piano** — se l'utente era su un piano diverso da trial e il delete l'ha resettato, reimposta `subscription_plan`/`trial_ends_at` con un UPDATE su `user_instances` dopo il re-pair.

## Perché non è automatizzato
Distinguere "owner legittimo da browser nuovo" da "attaccante che conosce il numero" senza un secondo fattore è impossibile: sono indistinguibili a livello di richiesta. Il fattore umano (verifica identità operatore) è il gate corretto finché non c'è l'OTP self-chat.
