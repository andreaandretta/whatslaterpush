-- Migration: message_templates
-- Pre-built message templates by ICP segment (admin-managed, immutable from UI).
-- All 40 seed entries marked is_beta=true since AI-generated from cliente-ideale.md,
-- not extracted from real user data. UI surfaces "🧪 Beta" badge accordingly.
-- Validation loop: aggregate user_templates over 20-50 real users → extract v2.
-- Date: 2026-05-26

create table if not exists public.message_templates (
  id uuid primary key default gen_random_uuid(),
  category text not null check (category in ('allenatore', 'parroco', 'scout', 'istruttore_guida', 'site_manager', 'generico')),
  emoji text,
  title text not null,
  body text not null,
  variables jsonb not null default '[]'::jsonb,
  display_order int not null default 0,
  is_active boolean not null default true,
  is_beta boolean not null default true,
  created_at timestamptz not null default now(),
  constraint unique_category_title unique (category, title)
);

create index if not exists idx_message_templates_category_active
  on public.message_templates(category, display_order)
  where is_active = true;

-- Seed inserts. Idempotent via ON CONFLICT on (category, title).
insert into public.message_templates (category, emoji, title, body, variables, display_order) values
  ('allenatore', $$🏃$$, $$Convocazione partita$$, $$🏃 Convocazione partita {giorno} ore {orario} — campo {luogo}. Ritrovo 30 min prima per riscaldamento. Portate borraccia e divisa pulita.$$, '["giorno","orario","luogo"]'::jsonb, 1),
  ('allenatore', $$❌$$, $$Allenamento annullato$$, $$❌ Allenamento di oggi annullato per {motivo}. Recupero {giorno_recupero} alla stessa ora. Scusate per l'imprevisto.$$, '["motivo","giorno_recupero"]'::jsonb, 2),
  ('allenatore', $$📋$$, $$Modulo iscrizione$$, $$📋 Ricordo: scadenza modulo firmato entro {data}. Chi non lo consegna non potrà giocare la prossima partita. Grazie per la collaborazione.$$, '["data"]'::jsonb, 3),
  ('allenatore', $$🚌$$, $$Trasferta$$, $$🚌 Trasferta {giorno}: ritrovo {orario} davanti agli spogliatoi. Partenza puntuale. Portate pranzo al sacco e merenda. Rientro previsto ore {orario_rientro}.$$, '["giorno","orario","orario_rientro"]'::jsonb, 4),
  ('allenatore', $$🏆$$, $$Vittoria!$$, $$🏆 Grandi ragazzi! Vittoria meritata oggi. Ottimo gioco di squadra. Riposo domani, ci vediamo {giorno_prossimo} per il prossimo allenamento. Forza {nome_squadra}!$$, '["giorno_prossimo","nome_squadra"]'::jsonb, 5),
  ('allenatore', $$💪$$, $$Promemoria allenamento settimanale$$, $$💪 Promemoria: allenamento {giorno} ore {orario} al campo {luogo}. Portate scarpini, parastinchi e voglia di lavorare. Ci vediamo lì!$$, '["giorno","orario","luogo"]'::jsonb, 6),
  ('allenatore', $$📊$$, $$Riunione genitori$$, $$📊 Riunione genitori {giorno} ore {orario} presso {luogo}. Argomenti: programmazione stagione, iscrizioni, tornei. La presenza è importante.$$, '["giorno","orario","luogo"]'::jsonb, 7),
  ('allenatore', $$🩹$$, $$Certificato medico$$, $$🩹 Reminder: certificato medico in scadenza il {data}. Rinnovatelo entro la fine del mese, altrimenti niente partita. Costo c/o medico sportivo €{costo_circa}.$$, '["data","costo_circa"]'::jsonb, 8),
  ('allenatore', $$🎉$$, $$Festa fine stagione$$, $$🎉 Festa fine stagione {data} ore {orario} presso {luogo}. Cena di squadra + premiazioni. Confermate presenza vostra e dei familiari entro {data_conferma}.$$, '["data","orario","luogo","data_conferma"]'::jsonb, 9),
  ('allenatore', $$🏥$$, $$Infortunio - come sta?$$, $$🏥 Ciao {nome}, come va l'infortunio? Aggiornami quando puoi. Quando ti sentirai pronto, ricomincia gradualmente. Forza, ti aspettiamo!$$, '["nome"]'::jsonb, 10),
  ('allenatore', $$⚽$$, $$Cambio orario allenamento$$, $$⚽ Attenzione cambio orario: l'allenamento di {giorno} sarà alle {orario_nuovo} invece di {orario_vecchio}. Stesso campo. Confermate per favore.$$, '["giorno","orario_nuovo","orario_vecchio"]'::jsonb, 11),
  ('allenatore', $$💰$$, $$Quota iscrizione$$, $$💰 Promemoria: quota iscrizione €{importo} da versare entro {data}. Modalità: {modalita_pagamento}. Per dubbi rispondete qui o chiamatemi.$$, '["importo","data","modalita_pagamento"]'::jsonb, 12),
  ('parroco', $$⛪$$, $$Messa di domani$$, $$⛪ Vi ricordo la Santa Messa di domani alle ore {orario} nella nostra parrocchia. Vi aspetto. Buona serata.$$, '["orario"]'::jsonb, 1),
  ('parroco', $$📚$$, $$Catechismo settimanale$$, $$📚 Catechismo {giorno} ore {orario} — aula {numero_aula}. Portate Bibbia e quaderno. A questa settimana parleremo di {argomento}.$$, '["giorno","orario","numero_aula","argomento"]'::jsonb, 2),
  ('parroco', $$🎉$$, $$Festa patronale$$, $$🎉 Festa patronale {data}. Programma completo: {link_programma}. Vi aspetto numerosi! Per chi può dare una mano nei preparativi, rispondete qui.$$, '["data","link_programma"]'::jsonb, 3),
  ('parroco', $$💒$$, $$Cresima - prove$$, $$💒 Promemoria cresimandi: prove generali {giorno} ore {orario} in chiesa. Padrini e madrine sono pregati di partecipare. Vestito appropriato, no jeans né scarpe sportive.$$, '["giorno","orario"]'::jsonb, 4),
  ('parroco', $$🕯️$$, $$Veglia / funzione speciale$$, $$🕯️ Vi invito alla {tipo_funzione} di {data} alle {orario}. Sarà un momento importante della nostra comunità. Vi aspetto in chiesa.$$, '["tipo_funzione","data","orario"]'::jsonb, 5),
  ('parroco', $$🎵$$, $$Prove coro$$, $$🎵 Coristi: prove {giorno} ore {orario} in sacrestia. Ripassiamo {canti}. Vi aspetto, è importante essere tutti per domenica.$$, '["giorno","orario","canti"]'::jsonb, 6),
  ('parroco', $$🧒$$, $$Oratorio - chiusura/apertura$$, $$🧒 Oratorio {stato} {giorno} {orario}. Per info chiama {numero}. Vi aspettiamo coi vostri ragazzi.$$, '["stato","giorno","orario","numero"]'::jsonb, 7),
  ('parroco', $$🙏$$, $$Caritas - raccolta$$, $$🙏 Caritas: raccolta {tipo_raccolta} {data}. Punto di consegna: {luogo}. Grazie per la vostra generosità.$$, '["tipo_raccolta","data","luogo"]'::jsonb, 8),
  ('parroco', $$📖$$, $$Gruppo lettura biblica$$, $$📖 Gruppo lettura biblica {giorno} ore {orario}. Questa settimana leggiamo {brano}. Portate la Bibbia.$$, '["giorno","orario","brano"]'::jsonb, 9),
  ('parroco', $$❌$$, $$Funzione annullata$$, $$❌ Annullo la {tipo_funzione} di {data} per {motivo}. La recupereremo {data_recupero}. Scusate per l'imprevisto.$$, '["tipo_funzione","data","motivo","data_recupero"]'::jsonb, 10),
  ('scout', $$⛺$$, $$Uscita di squadriglia$$, $$⛺ Uscita {giorno}: ritrovo {luogo_ritrovo} ore {orario}. Portate: zaino, borraccia, kway, pranzo al sacco, sacco a pelo se pernotto. Rientro {orario_rientro}. Buona caccia!$$, '["giorno","luogo_ritrovo","orario","orario_rientro"]'::jsonb, 1),
  ('scout', $$💧$$, $$Borraccia + pranzo$$, $$💧 Promemoria: domani borraccia piena, pranzo al sacco, scarpe da trekking. Non scarpe da ginnastica. Buona giornata!$$, '[]'::jsonb, 2),
  ('scout', $$📝$$, $$Riunione di branca$$, $$📝 Riunione di branca {giorno} ore {orario} in sede. Argomento: {argomento}. Portate quaderno di caccia. Buona caccia!$$, '["giorno","orario","argomento"]'::jsonb, 3),
  ('scout', $$🔥$$, $$Bivacco / campo estivo$$, $$🔥 {tipo_evento}: partenza {data} ore {orario_partenza} da {luogo_partenza}, rientro {data_rientro}. Lista materiale completa: {link_lista}. Quota: €{quota}. Per dubbi chiama.$$, '["tipo_evento","data","orario_partenza","luogo_partenza","data_rientro","link_lista","quota"]'::jsonb, 4),
  ('scout', $$🎽$$, $$Cerimonia uniforme$$, $$🎽 Cerimonia {tipo_cerimonia} {data} ore {orario}. Uniforme completa: camicia stirata, fazzolettone, beret, scarponcini lucidi. Vi aspetto in piazza.$$, '["tipo_cerimonia","data","orario"]'::jsonb, 5),
  ('scout', $$👨‍👩‍👧$$, $$Riunione genitori scout$$, $$👨‍👩‍👧 Riunione genitori {giorno} ore {orario} in sede. Argomenti: programma anno, quote, campo estivo. Importante essere presenti.$$, '["giorno","orario"]'::jsonb, 6),
  ('scout', $$❌$$, $$Riunione annullata$$, $$❌ Riunione di {giorno} annullata per {motivo}. Recupero {data_recupero}. Buona caccia!$$, '["giorno","motivo","data_recupero"]'::jsonb, 7),
  ('scout', $$🎯$$, $$Specialità / brevetto$$, $$🎯 Ricordo prove specialità {nome_specialita} {data}. Ripassate {cosa_ripassare}. Sono fiero di voi, andate alla grande!$$, '["nome_specialita","data","cosa_ripassare"]'::jsonb, 8),
  ('istruttore_guida', $$🚗$$, $$Conferma lezione di guida$$, $$🚗 {nome}, confermo la lezione di guida di {giorno} ore {orario}. Punto di ritrovo: {luogo}. Porta patente e foglio rosa. A presto!$$, '["nome","giorno","orario","luogo"]'::jsonb, 1),
  ('istruttore_guida', $$📋$$, $$Quiz teoria$$, $$📋 {nome}, domani quiz teoria ore {orario}. Porta documento di identità e una penna. Ti consiglio di ripassare {argomenti_focus}.$$, '["nome","orario","argomenti_focus"]'::jsonb, 2),
  ('istruttore_guida', $$🎓$$, $$Esame guida pratica$$, $$🎓 {nome}, esame di guida {data} ore {orario} presso {sede_esame}. Vieni in scuola guida 30 min prima. Patente, foglio rosa, ricevuta. In bocca al lupo!$$, '["nome","data","orario","sede_esame"]'::jsonb, 3),
  ('istruttore_guida', $$❌$$, $$Lezione spostata$$, $$❌ {nome}, ho dovuto spostare la tua lezione di {giorno_originale} al {giorno_nuovo} stessa ora. Ti torna? Se no, chiama in scuola guida.$$, '["nome","giorno_originale","giorno_nuovo"]'::jsonb, 4),
  ('istruttore_guida', $$📚$$, $$Promemoria lezione teoria$$, $$📚 Stasera lezione di teoria ore {orario} in aula {numero_aula}. Argomento: {argomento_lezione}. Portate il quiz book. Vi aspetto!$$, '["orario","numero_aula","argomento_lezione"]'::jsonb, 5),
  ('istruttore_guida', $$💰$$, $$Rata iscrizione$$, $$💰 {nome}, promemoria rata €{importo} in scadenza il {data}. Puoi pagare in sede, bonifico o {altro_metodo}. Per dubbi chiamami.$$, '["nome","importo","data","altro_metodo"]'::jsonb, 6),
  ('site_manager', $$🏗️$$, $$Reminder intervento manutenzione$$, $$🏗️ {nome}, ricordo intervento {tipo_intervento} a {indirizzo_struttura} {giorno} ore {orario}. Confermami presenza tecnico e accesso. Grazie.$$, '["nome","tipo_intervento","indirizzo_struttura","giorno","orario"]'::jsonb, 1),
  ('site_manager', $$📦$$, $$Conferma consegna fornitore$$, $$📦 Conferma consegna {materiale} prevista {giorno} ore {orario} a {indirizzo}. Riceverà {persona_referente}. Cellulare ricevente: {numero}.$$, '["materiale","giorno","orario","indirizzo","persona_referente","numero"]'::jsonb, 2),
  ('site_manager', $$⚠️$$, $$Allerta urgenza$$, $$⚠️ {nome}, urgenza presso {luogo}: {descrizione_problema}. Servirebbe intervento entro {orario_richiesto}. Confermi disponibilità o suggerisci alternativa?$$, '["nome","luogo","descrizione_problema","orario_richiesto"]'::jsonb, 3),
  ('site_manager', $$📊$$, $$Report settimanale strutture$$, $$📊 {nome}, report settimanale strutture: tutto regolare tranne {eventuali_anomalie}. Prossimo controllo {giorno}. Per dettagli chiama o passa in ufficio.$$, '["nome","eventuali_anomalie","giorno"]'::jsonb, 4)
on conflict (category, title) do nothing;
