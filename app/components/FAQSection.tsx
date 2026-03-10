'use client';
import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '../lib/cn';

const faqs = [
  { q: "Il mio WhatsApp è sicuro?", a: "Assolutamente sì. Usiamo lo stesso protocollo di WhatsApp Web. Non leggiamo i tuoi messaggi. I dati sono protetti con Row Level Security su database PostgreSQL." },
  { q: "Devo scansionare un QR Code?", a: "Puoi scegliere: scansiona un QR Code oppure inserisci un codice di abbinamento a 8 cifre direttamente su WhatsApp. Entrambi i metodi funzionano dal cellulare." },
  { q: "Cosa succede se il mio telefono è spento?", a: "Il messaggio resta in coda. Quando torni online, viene inviato automaticamente. Ti avvisiamo se qualcosa non va." },
  { q: "Posso annullare un messaggio programmato?", a: "Sì. Scrivi 'annulla' o 'cancella [nome]' nella chat con Te Stesso, oppure eliminalo dalla dashboard." },
  { q: "Come funziona l'AI?", a: "Scrivi in linguaggio naturale — 'domani alle 9', 'fra 2 ore', 'lunedì mattina' — e la nostra AI (GPT-4o Mini) capisce esattamente quando inviare." }
];

export default function FAQSection() {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  return (
    <section id="faq" className="py-24 bg-background">
      <div className="max-w-3xl mx-auto px-6">
        <h2 className="text-4xl font-bold text-text-primary mb-12 text-center">Domande Frequenti</h2>
        <div className="space-y-4">
          {faqs.map((faq, i) => (
            <div key={i} className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
              <button
                className="w-full px-6 py-5 text-left font-semibold flex justify-between items-center focus:outline-none"
                onClick={() => setOpenIndex(openIndex === i ? null : i)}
              >
                {faq.q}
                <ChevronDown className={cn("w-5 h-5 text-gray-400 transition-transform duration-300", openIndex === i && "rotate-180")} />
              </button>
              <div
                className={cn("px-6 overflow-hidden transition-all duration-300 ease-in-out", openIndex === i ? "max-h-40 pb-5 opacity-100" : "max-h-0 opacity-0")}
              >
                <p className="text-text-secondary text-sm leading-relaxed">{faq.a}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
