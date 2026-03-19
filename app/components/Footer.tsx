'use client';
import { Calendar } from 'lucide-react';

export default function Footer() {
  return (
    <footer className="bg-text-primary text-white rounded-t-[4rem] pt-20 pb-10 px-6 mt-20">
      <div className="max-w-5xl mx-auto flex flex-col items-center text-center">
        <div className="flex items-center gap-2 font-heading font-bold text-2xl tracking-tight mb-4">
          <Calendar className="w-8 h-8 text-primary" />
          <span>WhatsLater</span>
        </div>
        <p className="text-gray-400 mb-12">Promemoria WhatsApp automatici, dal tuo numero.</p>

        <div className="flex flex-wrap justify-center gap-8 text-sm font-medium text-gray-300 mb-16">
          <a href="/privacy" className="hover:text-white transition-colors">Privacy Policy</a>
          <a href="/terms" className="hover:text-white transition-colors">Termini di Servizio</a>
          <a href="mailto:supporto@whatslaterpush.vercel.app" className="hover:text-white transition-colors">Contatti</a>
        </div>

        <div className="text-xs text-gray-500 space-y-2">
          <p>Made in Italy - Hosted on EU servers</p>
          <p>Copyright &copy; 2026 WhatsLater</p>
        </div>
      </div>
    </footer>
  );
}
