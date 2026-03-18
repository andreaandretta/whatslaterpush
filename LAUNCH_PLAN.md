# WhatsLater — Piano di Lancio "7 Giorni Build + 23 Giorni Sell"

**Obiettivo:** 10 utenti paganti entro 30 giorni dal lancio.
**Approccio:** Mix pragmatico — costruire il minimo per lanciare, poi vendere.
**Stato:** Design approvato, pronto per implementazione.
**Data:** 18 Marzo 2026

---

## Principi Guida

1. **Non costruire feature senza utenti paganti.** Il prodotto funziona già. Il collo di bottiglia è Stripe + vendite.
2. **Un solo canale di acquisizione.** Outreach diretto di persona a professionisti locali. Niente TikTok, LinkedIn, SEO, blog fino a 20 paganti.
3. **Decision gate a 30 giorni.** Le feature future si decidono con dati reali, non ipotesi.
4. **Mai build e sell in parallelo.** Settimana 1 = solo codice. Settimane 2-4 = solo vendite + bugfix.

---

## Sezione 1: Architettura Stripe

### Prodotti Stripe

| Prodotto | Price ID | Prezzo | Tipo |
|----------|----------|--------|------|
| Personal | `da configurare` | €4,99/mese | Ricorrente |
| Business | `da configurare` | €19,99/mese | Ricorrente |
| Free | nessuno | €0 | Default senza abbonamento |

### Flusso Checkout

1. Utente clicca "Passa a Personal" o "Passa a Business" nella dashboard
2. `POST /api/stripe/checkout` crea Stripe Checkout Session con price_id, `client_reference_id = phone_number`
3. Stripe redirect → pagina successo → ritorno dashboard
4. Webhook Stripe `checkout.session.completed` → aggiorna `user_instances.subscription_plan` a `personal` o `business`

### Flusso Cancellazione

1. Utente clicca "Gestisci abbonamento" → Stripe Customer Portal
2. Webhook `customer.subscription.deleted` → downgrade `subscription_plan` a `free`

### Flusso Trial → Free Downgrade

- Campo `trial_ends_at` esiste già (7 giorni dal connect)
- Il cron controlla: se `trial_ends_at < now()` e `subscription_plan = 'trial'` → setta `subscription_plan = 'free'`
- Notifica utente via WhatsApp: "Il tuo trial è scaduto. Hai 3 messaggi/giorno gratuiti. Passa a Personal per €4,99/mese: [link]"
- Messaggi in coda oltre il limite: status `paused`, non `failed`

### Schema DB — Colonne da aggiungere a `user_instances`

- `stripe_customer_id` (text, nullable)
- `subscription_plan` (text, default `'trial'`) — valori: `trial`, `free`, `personal`, `business`
- `messages_sent_today` (int, default 0) — resettato a mezzanotte UTC dal cron
- `upsell_sent_today` (boolean, default false) — resettato con messages_sent_today

### Nuovi File API

- `app/api/stripe/checkout/route.ts` — crea Checkout Session
- `app/api/stripe/webhook/route.ts` — gestisce eventi Stripe
- `app/api/stripe/portal/route.ts` — crea Customer Portal session

---

## Sezione 2: Tier System e Limiti

### Limiti per Piano

| Piano | daily_limit | max_contacts | max_retry | history_days |
|-------|-------------|--------------|-----------|--------------|
| trial | 20 | 50 | 3 | 30 |
| free | 3 | 5 | 1 | 7 |
| personal | 20 | 50 | 3 | 30 |
| business | 50 | Illimitati | 3 | 90 |

Trial = stessi limiti di Personal per incentivare la conversione.

### Enforcement Points

1. **Limite giornaliero — cron `/api/cron/send-messages`:**
   - Prima di inviare: controlla `messages_sent_today < daily_limit`
   - Se limite raggiunto → messaggio resta `pending` (non `failed`)
   - Dopo invio riuscito: `messages_sent_today += 1`
   - Reset mezzanotte UTC: `UPDATE user_instances SET messages_sent_today = 0, upsell_sent_today = false`

2. **Limite contatti — webhook `/api/webhook`:**
   - Al salvataggio vCard: `SELECT COUNT(*) FROM pending_contacts WHERE owner_phone = X`
   - Se `count >= max_contacts` → risposta WhatsApp con upsell

3. **Storico messaggi — dashboard:**
   - Query filtrata: `created_at > now() - history_days`

4. **Retry — cron:**
   - Free: 1 tentativo. Trial/Personal/Business: fino a 3.

### Upsell Automatici via WhatsApp

- All'80% del limite: warning "Hai usato X dei tuoi Y messaggi oggi"
- Al 100%: "Hai raggiunto il limite. I prossimi messaggi saranno inviati domani. Passa a [piano]: [link]"
- Max 1 upsell/giorno per utente (flag `upsell_sent_today`)

### Funzione Centralizzata

```typescript
// app/lib/plans.ts
getPlanLimits(plan: string) → { dailyLimit, maxContacts, maxRetry, historyDays }
```

Unico file che mappa piano → limiti. Usato da cron, webhook e dashboard.

---

## Sezione 3: Cool-down Anti-Ban e Disclaimer

### Cool-down per Destinatario

- Max 3 messaggi allo stesso numero in 24 ore (tutti i piani)
- Query: `SELECT COUNT(*) FROM scheduled_messages WHERE recipient_phone = X AND instance_name = Y AND status = 'sent' AND sent_at > now() - 24h`
- Se `count >= 3` → messaggio resta `pending`, rischedulato al giorno dopo
- Notifica utente: "Per proteggere il tuo numero, max 3 messaggi allo stesso contatto in 24h. Il messaggio sarà inviato domani."

### Throttling Progressivo

- Oltre 10 messaggi in 10 minuti per istanza → rallenta a 1 msg/minuto
- Tracciato in memoria durante l'esecuzione batch del cron (non serve DB)

### Rate Limiting Esistente (confermato)

- 15 msg/min per utente
- Jitter 2-4s tra invii
- Retry max 3x poi `failed`

### Disclaimer WhatsApp Post-Connessione

Trigger: webhook `CONNECTION_UPDATE` → stato `open` (nuova connessione).

**Messaggio 1 — Disclaimer (inviato per primo):**
```
⚠️ Importante: WhatsLater usa la funzione "Dispositivi Collegati" di WhatsApp.
Un uso responsabile protegge il tuo numero.

• Max 20-30 messaggi mirati al giorno
• Solo a contatti che ti conoscono
• Nessun invio massivo o spam

Leggi i termini completi: https://whatslaterpush.vercel.app/terms

WhatsLater non è affiliato a Meta/WhatsApp.
```

**Delay 2 secondi**

**Messaggio 2 — Benvenuto/Onboarding (esistente)**

---

## Sezione 4: Piano Operativo 30 Giorni

### Fase Build (Giorni 1-7)

| Giorno | Task | Dipende da |
|--------|------|------------|
| 1 | Account Stripe + prodotti Personal/Business + price ID. Migration DB: `stripe_customer_id`, `subscription_plan`, `messages_sent_today`, `upsell_sent_today` | Nulla |
| 2 | `app/lib/plans.ts`. API `/api/stripe/checkout` e `/api/stripe/portal` | Giorno 1 |
| 3 | API `/api/stripe/webhook`. Test flusso completo Stripe test mode | Giorno 2 |
| 4 | Tier enforcement cron: limite giornaliero, reset mezzanotte, cool-down 3/dest/24h, throttling, trial→free, upsell | Giorno 2 |
| 5 | Tier enforcement webhook: limite contatti. Dashboard: storico filtrato, bottoni upgrade/gestisci | Giorno 2 |
| 6 | Disclaimer WhatsApp. Stripe live mode: attivare, test end-to-end carta reale | Giorno 3-5 |
| 7 | Buffer: bugfix, test e2e completo, deploy produzione | Giorno 1-6 |

### Fase Sell (Giorni 8-30)

| Settimana | Attività | Target |
|-----------|----------|--------|
| 2 (gg 8-14) | 30 professionisti locali di persona: medici, dentisti, parrucchieri, estetiste, personal trainer. Demo live, setup sul posto. | 5-8 trial |
| 3 (gg 15-21) | Follow-up trial, feedback, bugfix bloccanti. Altri 20 professionisti. | 10-15 trial, 3-5 paganti |
| 4 (gg 22-30) | Push conversione trial→pagante. Report finale. | 10 paganti |

### Cosa è Stato Tagliato (e Quando Rientra)

| Feature tagliata | Rientra quando |
|------------------|---------------|
| Referral system | Dopo 20 utenti, se passaparola naturale funziona |
| SEO/blog/sitemap | Dopo 50 utenti (risultati in 3-6 mesi) |
| Video TikTok/Reels | Dopo validazione messaging con utenti reali |
| Messaggi ricorrenti | Solo se feedback utenti lo richiede |
| Integrazione Google Calendar | Solo se feedback utenti lo richiede |
| Endpoint GDPR cancellazione dati | Gestione manuale via email fino a 100 utenti |

### Metriche di Successo a 30 Giorni

- 10 utenti paganti (€50-200 MRR)
- 0 ban WhatsApp
- Feedback qualitativo: feature mancante più richiesta, punto di attrito principale

### Decision Gate a 30 Giorni

| Segnale | Azione |
|---------|--------|
| Utenti chiedono messaggi ricorrenti | Priorità: implementare ricorrenza |
| Utenti chiedono integrazione calendario | Priorità: integrazione Google Calendar |
| Churn alto (provano e smettono) | Investigare: UX? flusso "scrivi a te stesso"? mancanza ricorrenza? |
| Conversione trial→pagante < 20% | Rivedere pricing o value proposition |
| Problemi di ban segnalati | Stringere cool-down, ridurre limiti |
| Referral spontaneo | Implementare referral system formale |
| Nessun interesse professionisti | Pivot target: utenti normali (compleanni, promemoria) |

---

## Gap Critici Identificati e Come Sono Gestiti

| Gap | Strategia |
|-----|-----------|
| **Churn/retention** | Non risolto con feature pre-lancio. Misurato con dati reali. Decision gate a 30gg decide le feature anti-churn. |
| **Moat difendibile** | Per ora il moat è la relazione personale con i clienti locali. Nessun competitor italiano noto. |
| **Solo founder** | Mai build e sell in parallelo. 1 settimana codice, 3 settimane vendite. |
| **Fatturazione italiana** | Gestione manuale fino a volumi significativi. Non bloccante per il lancio. |
| **Flusso manuale** | Validato con utenti reali. Se il feedback conferma il problema, si aggiungono ricorrenza/calendario. |

---

*Documento generato il 18 Marzo 2026. Da aggiornare con dati reali al decision gate (Giorno 30).*
