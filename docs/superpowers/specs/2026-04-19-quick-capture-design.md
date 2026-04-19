# Quick Capture — Design

> **Spec data**: 2026-04-19
> **Codename**: Quick Capture
> **Versione**: v1
> **Prerequisito di**: nessuno (C1 già LIVE come pre-requisito di feature dashboard)
> **Spec correlate**: `2026-04-19-phone-first-cookie-auth-design.md` (C1)

---

## 1. Sommario

Permettere all'utente di programmare un messaggio a un contatto **nuovo** (non già in `pending_contacts`) in **un solo turno**, senza il giro vCard:
- Il flusso primario sta in WhatsApp self-chat: Marco scrive *"Invia a Mario Cementi 3331234567 alle 17: mandi preventivo"* — l'AI riconosce il numero inline come destinatario, salta la richiesta di vCard, schedula e conferma.
- Il flusso secondario sta in dashboard: bottone "+ Nuovo follow-up" apre un modal a 4 campi (Nome, Numero, Data/ora, Messaggio); submit genera la stessa frase naturale e la inietta nella self-chat WhatsApp via `wa.me` deep-link. La pipeline webhook è **identica** per entrambi gli ingressi.

Nessun cambio di schema DB. Nessuna nuova route backend (modal usa solo `/api/auth/me` già esistente). Tutta la novità è (a) un'estensione del parser AI nel webhook e (b) un componente UI nuovo.

---

## 2. Contesto e motivazione

### 2.1 Stato attuale

Per programmare un messaggio a un contatto NON salvato, oggi Marco deve:
1. Aprire WhatsApp → self-chat
2. Allegare la vCard del destinatario
3. Aspettare che il bot confermi il salvataggio del contatto
4. Scrivere il messaggio col testo dell'orario
5. Aspettare il prompt di conferma
6. Rispondere "ok"

Sei step, due context switch (WhatsApp ↔ rubrica), ~90 secondi. Per un site manager in cantiere col casco e una mano libera, l'attrito è il vero ostacolo all'adozione.

### 2.2 Soluzione

**Una sola frase**, scritta in modo naturale, contenente sia il numero che il messaggio:

> *"Invia a Mario Cementi 3331234567 oggi alle 17: mi mandi il preventivo per i sacchi?"*

L'AI parsifica destinatario + numero + ora + testo dalla stessa stringa. Il numero inline è la "vCard implicita". Bot risponde con conferma o (per casi sicuri) schedula direttamente + offre `UNDO 60s`.

**Tap totali Marco-in-cantiere:** ~5 (apri chat + scrivi + invia + ok + invia). **Tempo:** ~20 secondi. **Sintassi rigida:** zero — l'AI accetta qualunque variante naturale.

### 2.3 Caso secondario (commerciale-da-PC)

Lo stesso utente, davanti al PC, vuole un'esperienza più strutturata. Bottone "+ Nuovo follow-up" sulla dashboard apre un modal con 4 campi. Submit genera la **stessa frase naturale** e la inietta nella self-chat tramite `wa.me/<self>?text=...`. L'utente fa solo "Invia" + "ok" su WhatsApp. Stessa pipeline, due ingressi.

---

## 3. Scope

### 3.1 In scope (v1)

- **Marco-mode** (WhatsApp self-chat): estensione AI prompt per riconoscere numero inline come `recipient_number`
- **Smart confirm**: skip prompt di conferma per casi sicuri (contatto già noto + data esplicita HH:MM)
- **UNDO 60s**: nuovo comando webhook fast-path che annulla l'ultimo messaggio schedulato negli ultimi 60s
- **Auto-save contatto** opzionale (con regole esplicite, no overwrite di contatti esistenti)
- **Dashboard modal** "+ Nuovo follow-up" con 4 campi + presets data + deep-link generator
- Pipeline webhook usata identica per entrambi gli ingressi
- Test unit + integration

### 3.2 Out of scope (v1.5+)

- **Backend-direct dashboard flow** (`POST /api/messages/quick-create` che salta WhatsApp): aggiunge UX più "appy" ma duplica logica AI/validazione. Differito.
- **OTP via self-chat per multi-device dashboard** (già differito da C1)
- **Auto-aggiornamento contatto su conflitto** (es. Mario salvato con 333... ma scritto inline 334...): in v1 usiamo l'inline per quella sola programmazione, non aggiorniamo silenziosamente. v1.5 può aggiungere "salva Mario nuovo numero".
- **Suggerimenti AI durante la digitazione** nel modal dashboard (autocomplete contatti salvati)
- **Bulk capture** (programmare N messaggi insieme)

---

## 4. Architettura

### 4.1 Flusso primario (Marco-mode WhatsApp)

```
Marco scrive nella self-chat:
  "Invia a Mario Cementi 3331234567 oggi alle 17: mi mandi il preventivo?"
  ↓
Evolution API → POST /api/webhook { MESSAGES_UPSERT, fromMe:true, remoteJid=ownerPhone }
  ↓
Pipeline webhook esistente (auth, dedup, self-chat check) — invariata
  ↓
Step nuovo: extractInlinePhone(text) trova "3331234567"
  ↓ se trovato
AI Groq prompt esteso riceve: testo + contatti salvati + flag {hasInlinePhone: true, inlinePhone: "393331234567", inlineName: "Mario Cementi"}
  ↓
AI ritorna: { action:"schedule", recipient:"Mario Cementi", recipient_number:"393331234567", message:"mi mandi il preventivo?", datetime:"2026-04-19T17:00:00+02:00", confidence:"high" }
  ↓
Backend valuta smart-confirm rules:
  - contatto noto in pending_contacts? NO (è nuovo)
  - data esplicita HH:MM? SÌ
  → CONTATTO NUOVO → richiede conferma esplicita
  ↓
Salva scheduled_messages con status='awaiting_confirm', salva pending_contact "Mario Cementi" → 393331234567 (auto-save pattern A, se sotto limite piano)
  ↓
Bot risponde:
  "Pronto a inviare a Mario Cementi (3331234567) oggi alle 17:00:
   'mi mandi il preventivo?'
   Rispondi OK per confermare, ANNULLA per cancellare."
  ↓
Marco scrive "ok"
  ↓
Pipeline esistente → status='pending', cron lo invia all'orario
```

### 4.2 Variante: contatto noto + data esplicita → smart-confirm skip + UNDO

```
Marco scrive (settimane dopo):
  "Mario alle 9: domani arrivi alle 8?"
  ↓
extractInlinePhone trova nulla (no numero)
  ↓
AI con context (contatti salvati): { recipient:"Mario", recipient_number:<from pending_contacts: 393331234567>, datetime:"2026-04-20T09:00:00+02:00" }
  ↓
Smart-confirm rules:
  - contatto noto? SÌ
  - data esplicita HH:MM? SÌ (alle 9)
  → SKIP CONFERMA, schedula direttamente
  ↓
Salva scheduled_messages status='pending'
  ↓
Bot risponde:
  "✅ Schedulato per Mario alle 09:00 (domani 20 aprile).
   Scrivi UNDO entro 60s per annullare."
  ↓
Marco può scrivere "undo" entro 60s → UNDO command (vedi 4.4)
```

### 4.3 Flusso secondario (Dashboard modal → deep-link → WhatsApp)

```
Marco apre /dashboard (cookie C1 valido) → bottone "+ Nuovo follow-up"
  ↓
Modal QuickCaptureModal si apre con 4 campi:
  - Nome (testo, opzionale ma raccomandato)
  - Numero (testo, validato lato client — vedi 4.6)
  - Data/ora (datetime-local + 3 chips preset: "tra 1h", "domani 9:00", "stasera 18:00")
  - Messaggio (textarea, max 4000 char)
  ↓
Marco compila e clicca "Apri WhatsApp e invia"
  ↓
Frontend:
  1. Chiama GET /api/auth/me → ottiene { phone: '393442582226', instanceName }
     (chiamata già fatta al mount della dashboard, valore in stato — non serve refetch)
  2. Valida formato numero, normalizza (riusa logica lib/phone.ts via /api/quick-capture/validate?
     → NO, validazione client-side semplice; il webhook valida server-side)
  3. Costruisce frase naturale:
     "Invia a {nome} {numero} {data_naturalizzata}: {messaggio}"
     Esempio: "Invia a Mario Cementi 393331234567 il 19/04 alle 17:00: mi mandi il preventivo?"
  4. URL-encode la frase
  5. window.location.href = `https://wa.me/${userPhone}?text=${encodedPhrase}`
  ↓
WhatsApp si apre (mobile native app o WhatsApp Web su desktop) con la frase precompilata nella self-chat
  ↓
Marco fa tap su "Invia"
  ↓
Webhook riceve la frase → pipeline 4.1 (identica)
```

### 4.4 UNDO command (nuovo fast-path webhook)

```
Marco scrive entro 60s da una conferma "✅ Schedulato":
  "undo" (case insensitive, anche "UNDO", " annulla ultimo ", "u")
  ↓
Webhook riconosce comando UNDO (fast-path, prima dell'AI)
  ↓
Query: SELECT id FROM scheduled_messages
  WHERE instance_phone = ownerPhone
    AND status = 'pending'
    AND created_at > NOW() - INTERVAL '60 seconds'
  ORDER BY created_at DESC
  LIMIT 1
  ↓
Trovato → UPDATE status='cancelled'. Bot: "✅ Annullato l'ultimo messaggio."
Non trovato → Bot: "Niente da annullare (timeout 60s scaduto, oppure nessuna programmazione recente)."
```

**Sintassi UNDO accettate** (case insensitive, trim spazi):
- `undo`, `u`, `annulla`, `cancella`, `annulla ultimo`, `annulla messaggio`

NON deve interferire con il comando esistente `annulla [num]` (cancella per indice in lista). Risoluzione: se dopo `annulla` c'è un numero → comando lista esistente; altrimenti UNDO.

### 4.5 Auto-save contatto (regole esplicite)

| Scenario | Comportamento |
|---|---|
| Numero inline + nome estratto, contatto NON in pending_contacts, sotto limite piano | Salva `(name, number)` in pending_contacts. Bot menziona "(salvato in rubrica)" nel summary. |
| Numero inline + nome, contatto già in pending_contacts con STESSO numero | No-op (già salvato) |
| Numero inline + nome, contatto già in pending_contacts con numero DIVERSO | **NON sovrascrivere**. Usa il numero inline solo per QUESTO messaggio. Bot menziona "(uso 333... per questa volta — il numero salvato per Mario è 334...)". |
| Numero inline, NESSUN nome estratto | Non salva (no name = no rubrica entry). Schedula soltanto. |
| Sopra limite piano contatti (Free=5, Trial/Personal=50, Business=∞) | Non salva (silently). Schedula comunque. Bot non blocca per il limite. |

### 4.6 Validazione numero (client + server)

**Client (modal dashboard):**
- Pattern accept: minimo 7 cifre dopo aver rimosso spazi/trattini/parentesi/`+`
- Se manca prefisso e prima cifra è `3` (mobile italiano) → prepend `39`
- Submit disabled finché numero non valida

**Server (webhook + dashboard endpoint):**
- Riusa `validatePhone()` esistente in `app/lib/phone.ts`
- Stesso pattern (silent normalize, accetta esteri con `+`, default `+39` per mobile italiani)

### 4.7 Definizione "data ambigua" (per smart-confirm)

Una data è **ambigua** (richiede conferma anche per contatto noto) se ALMENO UNA è vera:
- L'AI ritorna `confidence: "low"` o `confidence: "medium"` (Groq prompt esteso a includere il campo)
- Il testo originale contiene una keyword vaga: `tra un po'`, `più tardi`, `presto`, `dopo`, `dopo pranzo`, `stasera tardi`, `oggi tardi`, `prima o poi`
- L'AI ritorna `datetime` SENZA HH:MM specifico (es. solo "domani" senza orario)

In tutti gli altri casi (contatto noto + HH:MM esplicito + AI confidence high), si applica smart-confirm skip.

---

## 5. Modifiche al webhook (file: `app/api/webhook/route.ts`)

### 5.1 Nuova helper in `app/lib/webhook-utils.ts`

```typescript
/**
 * Estrae numero di telefono e nome (prima keyword) inline dal testo.
 * Esempio: "Invia a Mario Cementi 3331234567 alle 17: ..."
 *   → { phone: "393331234567", name: "Mario Cementi", textWithoutPhone: "Invia a Mario Cementi  alle 17: ..." }
 */
export function extractInlinePhoneAndName(text: string): {
  phone: string | null;
  name: string | null;
  textWithoutPhone: string;
};
```

Logica:
1. Regex per numeri: `/(\+?\d[\d\s\-().]{6,})/g` — cattura sequenze di cifre/separatori, min 7 cifre dopo pulizia
2. Per ogni match, normalizza con `validatePhone()` → se valido, è il candidato
3. Per il NOME: prendi 1-3 parole maiuscole CONTIGUE prima del numero (regex: `/([A-ZÀ-Ü][\wÀ-ÿ]+(?:\s+[A-ZÀ-Ü][\wÀ-ÿ]+){0,2})\s+(?=\+?\d)/`)
4. Rimuovi il numero dal testo per dare un input "pulito" all'AI

### 5.2 Estensione AI prompt

Sezione `## Comandi disponibili` del prompt esistente: aggiungere:

```
Se il messaggio contiene un numero di telefono inline (es. "a Mario 3331234567 alle 17"):
- Usa quel numero come recipient_number (non chiedere vCard)
- Estrai recipient (nome) dalle parole maiuscole vicine al numero
- Includi nel JSON: "recipient_number": "<numero normalizzato>", "recipient_name": "<nome>"

Includi SEMPRE nel JSON un campo "confidence": "high" | "medium" | "low":
- "high" se ora HH:MM esplicita e destinatario chiaro
- "medium" se ora chiara ma destinatario inferito
- "low" se ora ambigua ("tra un po'", "stasera", "presto", "dopo")
```

### 5.3 Nuovo step nel webhook handler (subito prima di chiamare l'AI)

```typescript
// In handleTextMessage (o equivalente, dopo dedup + identità)
const inline = extractInlinePhoneAndName(messageText);
const aiContext = {
  text: inline.textWithoutPhone,
  inlinePhone: inline.phone,
  inlineName: inline.name,
  savedContacts: pendingContacts,
};
const aiResult = await callAI(aiContext);
```

### 5.4 Smart-confirm decision logic (nuovo blocco prima di salvare)

```typescript
function shouldSkipConfirm(
  aiResult: AIResult,
  contactWasKnown: boolean,
  originalText: string
): boolean {
  if (!contactWasKnown) return false;
  if (aiResult.confidence !== 'high') return false;
  if (containsAmbiguousTimeKeyword(originalText)) return false;
  if (!hasExplicitHHMM(aiResult.datetime, originalText)) return false;
  return true;
}
```

Se `shouldSkipConfirm` ritorna true → status='pending' direttamente, bot risponde: 
*"✅ Schedulato per {nome} alle {ora}. Scrivi UNDO entro 60s per annullare."*

Altrimenti flusso esistente con `awaiting_confirm`.

### 5.5 Auto-save contatto

Subito dopo aver ricevuto AI result con `recipient_number` (o estratto da `extractInlinePhoneAndName`):

```typescript
async function autoSaveContact(
  ownerPhone: string,
  name: string | null,
  number: string,
  plan: string
): Promise<void> {
  if (!name) return;
  const limits = getPlanLimits(plan);
  const { count } = await supabase.from('pending_contacts').select('id', { count: 'exact', head: true }).eq('owner_phone', ownerPhone);
  if ((count || 0) >= limits.maxContacts) return; // silent no-op

  // Check existing
  const { data: existing } = await supabase.from('pending_contacts')
    .select('phone_number').eq('owner_phone', ownerPhone).ilike('contact_name', name).maybeSingle();
  if (existing) {
    if (existing.phone_number === number) return; // no-op
    // Conflict → don't overwrite. Caller should mention this in the summary.
    return;
  }

  await supabase.from('pending_contacts').insert({
    owner_phone: ownerPhone,
    contact_name: name,
    phone_number: number,
  });
}
```

Bot menziona "(salvato in rubrica)" nella risposta SE l'auto-save è avvenuto. Vale sia per il path `awaiting_confirm` (incluso nel summary di conferma) sia per il path smart-confirm-skip (incluso nel "✅ Schedulato per ... UNDO 60s").

### 5.6 UNDO command (fast-path)

In testa al text handler, prima di chiamare l'AI, aggiungere:

```typescript
const trimmed = messageText.trim().toLowerCase();
const UNDO_PATTERNS = ['undo', 'u', 'annulla', 'cancella', 'annulla ultimo', 'annulla messaggio'];
const isUndo = UNDO_PATTERNS.includes(trimmed)
  || (trimmed.startsWith('annulla ') && !/^annulla\s+\d+$/.test(trimmed)); // "annulla 3" è comando lista esistente

if (isUndo) {
  return await handleUndoCommand(supabase, ownerPhone, instanceName);
}
```

`handleUndoCommand`:
```typescript
async function handleUndoCommand(supabase, ownerPhone, instanceName) {
  const sixtySecondsAgo = new Date(Date.now() - 60 * 1000).toISOString();
  const { data: latest } = await supabase.from('scheduled_messages')
    .select('id, recipient_name, scheduled_at')
    .eq('instance_phone', ownerPhone)
    .eq('status', 'pending')
    .gt('created_at', sixtySecondsAgo)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!latest) {
    await sendBotMessage(instanceName, ownerPhone, 'Niente da annullare (timeout 60s scaduto o nessuna programmazione recente).');
    return NextResponse.json({ ok: true });
  }

  await supabase.from('scheduled_messages').update({ status: 'cancelled' }).eq('id', latest.id);
  const when = formatItalianDateTime(latest.scheduled_at);
  await sendBotMessage(instanceName, ownerPhone, `✅ Annullato il messaggio per ${latest.recipient_name || 'destinatario'} (${when}).`);
  return NextResponse.json({ ok: true });
}
```

---

## 6. Dashboard modal (file: `components/QuickCaptureModal.tsx` nuovo + modifica `app/dashboard/page.tsx`)

### 6.1 Componente

```typescript
interface QuickCaptureModalProps {
  open: boolean;
  onClose: () => void;
  userPhone: string; // viene dal /api/auth/me già fatto a mount della dashboard
}
```

UI struttura:
```
┌────────────────────────────────────┐
│ Nuovo follow-up               [×]  │
├────────────────────────────────────┤
│ Nome                                │
│ [_________________________]         │
│ Numero (con prefisso)               │
│ [_________________________]         │
│ Quando                              │
│ [datetime-local picker]             │
│ [Tra 1h] [Domani 9:00] [Stasera]    │
│ Messaggio                           │
│ [textarea ____________________]     │
│                                    │
│ [Apri WhatsApp e invia →]          │
└────────────────────────────────────┘
```

Stato locale: `{ name, phone, datetime, message, error }`

Chip preset onClick aggiorna `datetime` con valore calcolato:
- "Tra 1h" → ora + 1h
- "Domani 9:00" → tomorrow 09:00 local
- "Stasera 18:00" → today 18:00 local (o domani se passato)

### 6.2 Submit handler

```typescript
function handleSubmit() {
  // Client validation
  const cleanPhone = normalizeClientPhone(phone);
  if (!cleanPhone) { setError('Numero non valido'); return; }
  if (!message.trim()) { setError('Messaggio vuoto'); return; }
  const dt = new Date(datetime);
  if (isNaN(dt.getTime()) || dt < new Date(Date.now() + 60_000)) {
    setError('Data nel passato (minimo 1 minuto da ora)');
    return;
  }

  // Build natural phrase
  const datePhrase = formatDatePhrase(dt); // es. "il 19/04 alle 17:00" o "oggi alle 17:00" o "domani alle 09:00"
  const namePart = name.trim() ? `${name.trim()} ` : '';
  const phrase = `Invia a ${namePart}${cleanPhone} ${datePhrase}: ${message.trim()}`;

  // Deep-link
  const url = `https://wa.me/${userPhone}?text=${encodeURIComponent(phrase)}`;
  window.location.href = url;
}
```

### 6.3 Trigger nella dashboard

In `app/dashboard/page.tsx`, aggiungere bottone primario in alto:
```tsx
<Button onClick={() => setQuickCaptureOpen(true)} className="...">
  <Plus className="w-5 h-5 mr-2" /> Nuovo follow-up
</Button>
<QuickCaptureModal
  open={quickCaptureOpen}
  onClose={() => setQuickCaptureOpen(false)}
  userPhone={userPhone}
/>
```

---

## 7. File da creare

| File | Scopo | Dimensione stimata |
|---|---|---|
| `components/QuickCaptureModal.tsx` | Modal con 4 campi + presets + deep-link generator | ~180 righe |
| `app/lib/quick-capture-utils.ts` | `formatDatePhrase`, `containsAmbiguousTimeKeyword`, `hasExplicitHHMM` | ~80 righe |
| `__tests__/quick-capture-utils.test.ts` | Unit test per le funzioni helper | ~100 righe |
| `__tests__/webhook-quick-capture.test.ts` | Integration test del nuovo flusso (inline phone, smart-confirm, UNDO, auto-save conflict) | ~250 righe |

## 8. File da modificare

| File | Cambio |
|---|---|
| `app/lib/webhook-utils.ts` | Aggiungere `extractInlinePhoneAndName(text)` helper |
| `app/api/webhook/route.ts` | (a) UNDO fast-path in cima al text handler. (b) Step `extractInlinePhoneAndName` prima dell'AI. (c) Estensione contesto inviato a Groq. (d) Smart-confirm decision dopo AI. (e) Auto-save contatto. |
| AI system prompt (in `app/api/webhook/route.ts` o file estratto) | Estendere con regole numero inline + campo `confidence` |
| `app/dashboard/page.tsx` | Aggiungere bottone "+ Nuovo follow-up" + render modal |
| `__tests__/webhook-utils.test.ts` | Aggiungere test `extractInlinePhoneAndName` (vari pattern) |
| `docs/ARCHITETTURA.md` | Documentare Quick Capture nei flussi principali |

**Nessun cambio di schema DB.** Quick Capture riusa `scheduled_messages` (status `pending` o `awaiting_confirm`) e `pending_contacts` (auto-save).

---

## 9. Edge cases con risoluzione

| # | Caso | Risoluzione |
|---|---|---|
| 1 | Marco scrive un numero malformato inline ("Mario 333 12") | `extractInlinePhoneAndName` ritorna `phone:null`. AI prompt non riceve inlinePhone. AI cade nel ramo "ask vCard" come oggi, oppure restituisce errore di parsing. Bot chiede chiarimento. |
| 2 | Numero inline + nome contatto già esistente con numero diverso | Auto-save NON sovrascrive. Schedula con il numero inline. Bot summary include "(uso 333... per questa volta)". |
| 3 | Marco scrive "undo" senza aver schedulato negli ultimi 60s | Bot: "Niente da annullare (timeout 60s scaduto)". Nessuna azione DB. |
| 4 | Marco scrive "undo" mentre c'è un `awaiting_confirm` pending | UNDO opera solo su status='pending' (smart-confirmati). Per `awaiting_confirm` esiste già il comando "annulla" o "no". Documentato nell'help. |
| 5 | Marco fa "annulla" (senza numero) entro 60s da uno smart-confirm | Routing: "annulla" senza numero → UNDO. "annulla 3" → comando lista esistente. Distinzione via regex. |
| 6 | Modal dashboard: utente compila ma WhatsApp non è installato sul device | Deep-link `wa.me` genera fallback web (`web.whatsapp.com`) automaticamente nei browser moderni. Se neanche quello → utente vede "Aprire WhatsApp" → deve installare/loggarsi. v1 accetta. |
| 7 | Modal su PC con WhatsApp Web non loggato | `wa.me` redirige a `web.whatsapp.com`, prompt QR. Utente deve loggarsi prima. v1 accetta. |
| 8 | Utente Free al limite contatti (5) salva un sesto via Quick Capture | Auto-save silenziosamente non avviene. Schedulazione procede. Bot summary OMESSO il "(salvato in rubrica)". (Opzionale: bot menziona "Limite contatti raggiunto, upgrade a Personal per 50.") |
| 9 | AI Groq DOWN, OpenAI DOWN, regex fallback non matcha | Bot: "Non ho capito. Prova: 'Invia a [Nome] [numero] [orario]: [messaggio]'". Comportamento esistente, non degradato. |
| 10 | Marco copia/incolla una frase con doppi spazi o newline | `extractInlinePhoneAndName` normalizza whitespace. AI prompt è robusto. Nessun cambio. |
| 11 | Nome estratto contiene caratteri sospetti (script injection nel modal) | Server-side: `recipient_name` viene salvato come testo, mai eseguito. Client-side modal: React escapa per default. Safe. |
| 12 | URL del deep-link supera limiti browser (~8KB) | Messaggio max 4000 char + nome 50 + ora 30 + frase template 50 = ~4150 char encoded ≈ ~8.3KB worst case. Validare lato client `message.length <= 3500` per stare sotto soglia. |

---

## 10. Threat model

**Nuove superfici di attacco:**

| Vettore | Mitigazione |
|---|---|
| Marco condivide screenshot del modal con dati di un terzo → URL deep-link include numero terzo nel querystring | URL contiene solo dati che Marco ha appena inserito a mano. No leak di altri dati. Non è un nuovo vettore. |
| Attaccante con accesso a self-chat di Marco (rubato cookie C1?) usa Quick Capture per spammare | Già coperto da: rate limit messaggi/giorno (3-50/piano), rate limit/min (15/utente), cool-down 3 msg/destinatario/24h. Quick Capture eredita tutti questi. |
| Numero inline arriva al webhook → pipeline esistente lo invia → Marco involontariamente ha programmato spam a un numero estraneo | Smart-confirm RICHIEDE conferma esplicita per contatti nuovi. UNDO 60s come ulteriore rete. Per contatti già noti, l'utente è consapevole. |
| Iniezione SQL via `recipient_name` nell'auto-save | Supabase client usa parameterized queries. Safe. |

Nessun nuovo vettore non mitigato.

---

## 11. Strategia di test

### 11.1 Unit (`__tests__/quick-capture-utils.test.ts` + estensioni `webhook-utils.test.ts`)

`extractInlinePhoneAndName`:
- "Invia a Mario Cementi 3331234567 alle 17: msg" → `{phone:'393331234567', name:'Mario Cementi', textWithoutPhone:'Invia a Mario Cementi  alle 17: msg'}`
- "Mario 333 1234567 ora" (spaziato) → `{phone:'393331234567', name:'Mario'}`
- "scrivi a 393331234567 alle 17 ciao" (numero senza nome) → `{phone:'393331234567', name:null}`
- "Mario alle 17" (no numero) → `{phone:null, name:null}`
- "+44 7700 900123 alle 9" (estero) → `{phone:'447700900123', name:null}`
- "data 12/03/2026 alle 9" (numero che è data) → `{phone:null, name:null}` (confidence-based: data sembra orario, non phone)

`containsAmbiguousTimeKeyword`:
- "domani alle 17" → false
- "tra un po' ti scrivo" → true
- "dopo pranzo" → true
- "alle 14:30" → false

`hasExplicitHHMM`:
- "alle 17" → true (17:00 implicit)
- "alle 9:30" → true
- "domani" senza ora → false
- "stasera" senza ora → false

`formatDatePhrase`:
- Today 17:00 → "oggi alle 17:00"
- Tomorrow 09:00 → "domani alle 09:00"
- 5 days from now 14:00 → "il 24/04 alle 14:00"

### 11.2 Integration (`__tests__/webhook-quick-capture.test.ts`)

Mock Supabase + Groq. Casi:

1. **Quick Capture nuovo contatto + numero inline → awaiting_confirm + auto-save**
   - Input: "Invia a Mario Cementi 3331234567 oggi alle 17: prev"
   - Verify: scheduled_messages insert con status='awaiting_confirm', recipient_number='393331234567', pending_contacts insert ('Mario Cementi', '393331234567')

2. **Smart-confirm skip per contatto noto + ora esplicita**
   - Pre-arm: pending_contacts ha già "Mario" → "393331234567"
   - Input: "Mario alle 9: ciao"
   - Verify: scheduled_messages insert con status='pending' (NON awaiting_confirm), bot risponde con "✅ Schedulato... UNDO 60s"

3. **Smart-confirm NO skip per ora ambigua anche se contatto noto**
   - Pre-arm: pending_contacts ha "Mario"
   - Input: "Mario tra un po': ciao"
   - Verify: status='awaiting_confirm', bot chiede conferma esplicita

4. **UNDO trova messaggio recente**
   - Pre-arm: scheduled_messages ha 1 row status='pending', created_at=NOW-30s
   - Input: "undo"
   - Verify: row update a status='cancelled', bot conferma "Annullato"

5. **UNDO non trova nulla (timeout)**
   - Pre-arm: scheduled_messages ha row created_at=NOW-2m
   - Input: "undo"
   - Verify: nessun update, bot dice "Niente da annullare"

6. **UNDO non interferisce con `annulla [num]`**
   - Input: "annulla 3"
   - Verify: NON innesca UNDO; chiama il comando lista esistente

7. **Auto-save NON sovrascrive contatto esistente con numero diverso**
   - Pre-arm: pending_contacts ha "Mario" → "393331234567"
   - Input: "Invia a Mario 3334445555 alle 9: ciao"
   - Verify: NESSUN update di pending_contacts; scheduled_messages usa '393334445555'

8. **Auto-save fallisce silenziosamente se al limite piano**
   - Pre-arm: piano free, pending_contacts ha già 5 row
   - Input: "Invia a Nuovo 3331234567 alle 9: ciao"
   - Verify: scheduled_messages insert OK, pending_contacts NESSUN insert

### 11.3 E2E (Playwright, opzionale per v1)

- Aprire dashboard, click "+ Nuovo follow-up", verificare modal renderizza
- Compilare campi, click submit → verifica `window.location.href` viene settato a wa.me URL valido (intercept con `page.route`)

### 11.4 Test esistenti da non rompere

- Tutti i 150 test attuali devono restare verdi
- In particolare: `webhook.integration.test.ts` ha test sul flusso vCard esistente — verifica che sia ancora chiamabile (è il fallback per chi NON usa numero inline)

---

## 12. Rollout

Singolo deploy:
1. Merge feature branch → main
2. Vercel auto-deploy
3. Smoke test: aprire dashboard, click bottone, verificare modal apre + deep-link valido
4. Marco-mode: scrivere nella self-chat di test "Invia a NomeFinto 393331234567 oggi alle 23:59: test", verificare che il bot risponda con conferma; rispondere "ok"; verificare che il messaggio sia in coda; rispondere "undo" (entro 60s, ma in questo caso il messaggio è in awaiting_confirm non pending → UNDO non si applica, va testato dopo conferma)
5. Aggiornare `docs/ARCHITETTURA.md` sezione 5 (Flussi Principali) con il flusso Quick Capture

Rollback: `git revert` del merge commit. Nessuna migration DB da rollbackare.

---

## 13. Stima effort

| Pezzo | Ore |
|---|---|
| `extractInlinePhoneAndName` + test | 1-2h |
| `quick-capture-utils.ts` (3 funzioni) + test | 1.5h |
| AI prompt extension + decisione smart-confirm | 1-2h |
| UNDO command fast-path + test | 1h |
| Auto-save logic + test | 1h |
| `QuickCaptureModal.tsx` + integrazione dashboard | 3-4h |
| Integration test webhook (8 casi) | 2-3h |
| Smoke test produzione | 0.5h |
| Doc update | 0.5h |
| Buffer | 1.5-2h |
| **Totale** | **12-18h** (~1.5-2 giornate) |

---

## 14. Open questions / future work (v1.5+)

- **`POST /api/messages/quick-create`** backend-direct: per dashboard più "appy" senza switch a WhatsApp. Aggiunge ~6h, duplica logica AI (o richiede di estrarla in libreria condivisa).
- **Contatti autocomplete nel modal**: man mano che Marco salva contatti, il campo Nome suggerisce. Richiede endpoint `/api/contacts?q=...` cookie-protetto.
- **Aggiornamento contatto su conflitto**: comando esplicito tipo "salva Mario nuovo numero 333..." per overwrite intenzionale.
- **Bulk capture**: incollare una lista di "Nome Numero Ora Messaggio" → schedulazioni multiple in un colpo.
- **Mobile share intent**: app Android/iOS native dove "share to SchedWhats" precompila il modal con il numero del contatto condiviso. Fuori scope salvo PWA.
- **Banner dashboard ripristinato**: la dashboard refactor ha rimosso il banner "disconnesso/limite/trial" gated su `connStatus`. Ripristinare con gating cookie-based per v1.5.

---

## 15. Riferimenti file di codice attualmente coinvolti

- `app/api/webhook/route.ts` — handler principale, contiene flusso AI + comandi rapidi
- `app/lib/webhook-utils.ts` — `extractInlineRecipient`, `extractInlineMessage`, `findContactByName` esistenti
- `app/lib/phone.ts` — `validatePhone`, `normalizeItalianPhone`
- `app/lib/plans.ts` — `getPlanLimits` per maxContacts
- `app/dashboard/page.tsx` — dove va il bottone + modal (già refactor C1)
- `lib/evolution/client.ts` — per `sendBotMessage` UNDO response
