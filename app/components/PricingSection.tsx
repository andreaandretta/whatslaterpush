'use client';
import { CheckCircle2 } from 'lucide-react';

export default function PricingSection() {
  return (
    <section id="prezzi" className="py-24 bg-white">
      <div className="max-w-4xl mx-auto px-6 text-center">
        <h2 className="text-4xl md:text-5xl font-bold text-text-primary mb-4">Un prezzo. Nessuna sorpresa.</h2>
        <p className="text-xl text-text-secondary font-serif italic mb-16">Semplice come inviare un messaggio.</p>

        <div className="max-w-md mx-auto bg-white rounded-[3rem] p-10 shadow-[0_20px_50px_rgba(0,0,0,0.08)] border border-primary/20 relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-2 bg-primary"></div>
          <h3 className="text-2xl font-bold mb-2">WhatsLater</h3>
          <div className="flex items-baseline justify-center gap-1 mb-8">
            <span className="text-5xl font-bold">&euro;1.99</span>
            <span className="text-text-secondary">/mese</span>
          </div>

          <ul className="space-y-4 text-left mb-10">
            <li className="flex items-center gap-3"><CheckCircle2 className="w-5 h-5 text-primary" /> Messaggi illimitati*</li>
            <li className="flex items-center gap-3"><CheckCircle2 className="w-5 h-5 text-primary" /> Connessione QR Code o Codice</li>
            <li className="flex items-center gap-3"><CheckCircle2 className="w-5 h-5 text-primary" /> Linguaggio naturale AI</li>
            <li className="flex items-center gap-3"><CheckCircle2 className="w-5 h-5 text-primary" /> Coda messaggi in tempo reale</li>
            <li className="flex items-center gap-3"><CheckCircle2 className="w-5 h-5 text-primary" /> Supporto via WhatsApp</li>
          </ul>

          <a href="#connetti" className="block w-full bg-primary text-white py-4 rounded-2xl font-bold text-lg hover:scale-[1.02] transition-transform shadow-lg shadow-primary/30 mb-4">
            Inizia Ora — &euro;1.99/mese
          </a>
          <p className="text-[10px] text-gray-400">*Soggetto a rate limiting di 15 msg/min per protezione account.</p>
        </div>

        <p className="mt-12 text-sm text-text-secondary">
          Hai un team o un business? <a href="https://wa.me/393442582226" className="text-primary font-medium hover:underline">Scrivici.</a>
        </p>
      </div>
    </section>
  );
}
