'use client';
import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '../lib/cn';

interface FAQSectionProps {
  theme?: 'light' | 'dark';
  billingEnabled?: boolean;
}

const faqs = [
  {
    q: 'Il messaggio parte dal mio numero personale o da un numero aziendale?',
    a: 'Dal tuo numero personale, quello che hai collegato in fase di setup. Chi riceve vede la chat con te — niente bot, niente sender "WhatsLater". Per loro è come se l\'avessi scritto manualmente in quel momento.',
  },
  {
    q: "Cosa significa \"senza broker\"?",
    a: 'Altri servizi (Wati, Respond.io, Twilio) usano la WhatsApp Business API: i messaggi passano per server intermedi e i tuoi contatti vedono un numero generico. WhatsLater usa il TUO numero personale via Evolution API: i messaggi partono come se li scrivessi tu, e nessun broker ha accesso alle conversazioni.',
  },
  {
    q: 'È contro i termini di WhatsApp? Rischio il ban?',
    a: 'No. WhatsLater usa la stessa tecnologia di WhatsApp Web (linked devices ufficiali). Non simuliamo click, non usiamo API non autorizzate, non facciamo invii massivi. Tu schedula i messaggi che mandi comunque ogni giorno — semplicemente li scrivi prima.',
  },
  {
    q: "In cosa è diverso da WhatsApp Business o dallo scheduling nativo?",
    a: "WhatsApp Business serve a chi gestisce un'attività con catalogo, risposte automatiche e profilo aziendale — non a chi vuole solo programmare un messaggio dal proprio numero personale. Lo scheduling nativo invece esiste solo dentro le Community e richiede il telefono acceso. WhatsLater funziona sul tuo numero normale, dal browser, anche col telefono spento.",
  },
  {
    q: 'Cosa succede se il mio telefono è spento?',
    a: 'Il messaggio parte lo stesso. WhatsLater gira su un server dedicato connesso al tuo account WhatsApp via linked devices — stessa tecnologia di WhatsApp Web, funziona anche col tuo telefono offline. Spegni la sera senza pensieri.',
  },
  {
    q: 'Posso vedere il messaggio prima che parta?',
    a: 'Sì, attivando "Richiedi approvazione" nelle Opzioni avanzate della schermata di scheduling. Prima dell\'invio ricevi una notifica e devi confermare. Di default è disattivato — la maggior parte preferisce setup-and-forget.',
  },
  {
    q: 'I miei messaggi e contatti sono al sicuro?',
    a: "I messaggi schedulati sono cifrati a riposo sul nostro server europeo (Frankfurt). Una volta inviati, vengono eliminati dopo il periodo di storico previsto dal piano (7/30/60/90 giorni). Non leggiamo le tue chat, non analizziamo il contenuto, non condividiamo nulla con terze parti.",
  },
  {
    q: 'Posso programmare messaggi ricorrenti tipo "ogni lunedì alle 7 alla squadra"?',
    a: 'Sì. Quando programmi il messaggio, tocca "Ripeti" e scegli: ogni giorno, ogni settimana (stesso giorno) o ogni mese (stesso giorno del mese). Per "ogni lunedì alle 7" programmi il primo lunedì alle 7 e imposti Ripeti → ogni lunedì: le occorrenze successive si creano da sole, e l\'orario resta quello italiano anche al cambio d\'ora legale.',
  },
];

export default function FAQSection({ theme = 'light', billingEnabled = true }: FAQSectionProps) {
  // During the free beta there are no per-plan retention tiers: everyone is
  // on the beta plan's 90-day history (app/lib/plans.ts).
  const items = billingEnabled
    ? faqs
    : faqs.map((f) => ({
        ...f,
        a: f.a.replace(
          'dopo il periodo di storico previsto dal piano (7/30/60/90 giorni)',
          'dopo il periodo di storico della beta (90 giorni)'
        ),
      }));
  const [openIndex, setOpenIndex] = useState<number | null>(0);
  const dark = theme === 'dark';

  const section = dark ? 'bg-[#111B21]' : 'bg-white';
  const heading = dark ? 'text-white' : 'text-text-primary';
  const cardBg = dark ? 'bg-[#202C33]' : 'bg-white';
  const cardBorder = dark ? 'border-[#2A3942]' : 'border-[#E9EDEF]';
  const questionClosed = dark ? 'text-white' : 'text-[#111B21]';
  const questionOpen = dark ? 'text-primary' : 'text-[#075E54]';
  const chevronClosed = dark ? 'text-gray-400' : 'text-[#667781]';
  const chevronOpen = 'text-primary';
  const answer = dark ? 'text-gray-400' : 'text-text-secondary';

  return (
    <section id="faq" className={`py-24 ${section}`}>
      <div className="max-w-3xl mx-auto px-6">
        <h2 className={`font-heading text-3xl sm:text-4xl font-bold mb-3 text-center ${heading}`}>
          Domande frequenti
        </h2>
        <p className={`text-center mb-12 ${dark ? 'text-gray-400' : 'text-text-secondary'}`}>
          Le risposte che servono prima di provarlo.
        </p>
        <div className="space-y-4">
          {items.map((faq, i) => (
            <div
              key={i}
              className={`rounded-2xl shadow-sm border overflow-hidden ${cardBg} ${cardBorder}`}
            >
              <button
                className={cn(
                  'w-full px-6 py-5 text-left font-semibold flex justify-between items-center gap-4 focus:outline-none transition-colors',
                  openIndex === i ? questionOpen : questionClosed
                )}
                onClick={() => setOpenIndex(openIndex === i ? null : i)}
              >
                <span className="flex-1">{faq.q}</span>
                <ChevronDown
                  className={cn(
                    'w-5 h-5 shrink-0 transition-all duration-300',
                    openIndex === i ? `rotate-180 ${chevronOpen}` : chevronClosed
                  )}
                />
              </button>
              <div
                className={cn(
                  'px-6 overflow-hidden transition-all duration-300 ease-in-out',
                  openIndex === i ? 'max-h-96 pb-5 opacity-100' : 'max-h-0 opacity-0'
                )}
              >
                <p className={`text-sm leading-relaxed ${answer}`}>{faq.a}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
