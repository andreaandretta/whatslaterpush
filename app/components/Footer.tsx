'use client';
import { Calendar } from 'lucide-react';

export default function Footer() {
  return (
    <footer className="bg-text-primary text-white rounded-t-[4rem] pt-20 pb-10 px-6 mt-20">
      <div className="max-w-5xl mx-auto flex flex-col items-center text-center">
        <div className="flex items-center gap-2 font-bold text-2xl tracking-tight mb-4">
          <Calendar className="w-8 h-8 text-primary" />
          <span>WhatsLater</span>
        </div>
        <p className="text-gray-400 mb-12">Scrivi ora, invia dopo.</p>

        <div className="flex flex-wrap justify-center gap-8 text-sm font-medium text-gray-300 mb-16">
          <a href="#" className="hover:text-white transition-colors">Privacy Policy</a>
          <a href="#" className="hover:text-white transition-colors">Termini di Servizio</a>
          <a href="#" className="hover:text-white transition-colors">Contatti</a>
        </div>

        <div className="flex items-center gap-2 bg-white/10 px-4 py-2 rounded-full text-xs font-medium mb-8">
          <div className="w-2 h-2 bg-primary rounded-full animate-pulse"></div>
          Sistema Operativo
        </div>

        <div className="text-xs text-gray-500 space-y-2">
          <p>Made in Italy - Hosted on EU servers</p>
          <p>Copyright &copy; 2026 WhatsLater</p>
        </div>
      </div>
    </footer>
  );
}
