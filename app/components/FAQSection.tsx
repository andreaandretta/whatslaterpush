'use client';
import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '../lib/cn';

const faqs = [
  { q: "E sicuro collegare WhatsApp?", a: "I tuoi dati sono protetti con la massima sicurezza. Nessuno puo leggere i tuoi messaggi." },
  { q: "Come collego WhatsApp?", a: "Inserisci il tuo numero di telefono e segui le istruzioni. Ci vogliono 30 secondi." },
  { q: "E se il telefono e spento?", a: "I messaggi programmati partono anche se il telefono e spento." },
  { q: "Posso annullare un messaggio programmato?", a: "Si, dalla dashboard clicca 'Annulla invio' su qualsiasi messaggio non ancora inviato." },
  { q: "Come capisce gli orari?", a: "Scrivi normalmente: 'domani alle 15', 'lunedi mattina', 'tra 2 ore'. WhatsLater capisce automaticamente." },
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
