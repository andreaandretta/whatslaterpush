'use client';
import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '../lib/cn';

interface FAQSectionProps {
  theme?: 'light' | 'dark';
}

const faqs = [
  {
    q: "Il messaggio parte dal mio numero personale o da un numero aziendale?",
    a: "Dal tuo numero personale, quello che hai collegato in fase di setup. Chi riceve vede la chat con te — niente bot, niente sender \"WhatsLater\". Per loro è come se l'avessi scritto manualmente in quel momento.",
  },
  {
    q: "Funziona anche per coordinare fornitori sul cantiere?",
    a: "Sì, è uno degli usi più comuni. Site manager e geometri schedulano gli avvisi al fornitore la sera prima della consegna — \"domani 8:30 al cancello B\", \"l'ingegnere XY sarà in cantiere giovedì alle 14\". WhatsApp resta il canale, tu eviti di doverlo ricordare alle 6 del mattino.",
  },
  {
    q: "Cosa succede se il mio telefono è spento?",
    a: "Il messaggio parte lo stesso. WhatsLater gira su un server dedicato connesso al tuo account WhatsApp via linked devices — stessa tecnologia di WhatsApp Web, funziona anche col tuo telefono offline. Spegni la sera senza pensieri.",
  },
  {
    q: "Posso vedere il messaggio prima che parta?",
    a: "Sì, attivando \"Richiedi approvazione\" nelle Opzioni avanzate della schermata di scheduling. Prima dell'invio ricevi una notifica e devi confermare. Di default è disattivato — la maggior parte preferisce setup-and-forget.",
  },
  {
    q: 'Posso programmare messaggi ricorrenti tipo "ogni lunedì alle 7 alla squadra"?',
    a: "Non ancora — è in roadmap per la prossima release. Oggi puoi schedulare un messaggio alla volta. Workaround che usano gli allenatori: la domenica sera, in 10 minuti, schedulano i 4 lunedì del mese. Il copia-incolla del testo è veloce.",
  },
];

export default function FAQSection({ theme = 'light' }: FAQSectionProps) {
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
        <h2 className={`font-heading text-3xl sm:text-4xl font-bold mb-12 text-center ${heading}`}>Domande Frequenti</h2>
        <div className="space-y-4">
          {faqs.map((faq, i) => (
            <div key={i} className={`rounded-2xl shadow-sm border overflow-hidden ${cardBg} ${cardBorder}`}>
              <button
                className={cn(
                  "w-full px-6 py-5 text-left font-semibold flex justify-between items-center focus:outline-none transition-colors",
                  openIndex === i ? questionOpen : questionClosed
                )}
                onClick={() => setOpenIndex(openIndex === i ? null : i)}
              >
                {faq.q}
                <ChevronDown className={cn(
                  "w-5 h-5 transition-all duration-300",
                  openIndex === i ? `rotate-180 ${chevronOpen}` : chevronClosed
                )} />
              </button>
              <div
                className={cn("px-6 overflow-hidden transition-all duration-300 ease-in-out", openIndex === i ? "max-h-64 pb-5 opacity-100" : "max-h-0 opacity-0")}
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
