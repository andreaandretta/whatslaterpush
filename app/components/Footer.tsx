'use client';

export default function Footer() {
  return (
    <footer className="bg-[#075E54] text-white rounded-t-[4rem] pt-20 pb-10 px-6 mt-20">
      <div className="max-w-5xl mx-auto flex flex-col items-center text-center">
        <div className="flex items-center gap-2 font-heading font-bold text-2xl tracking-tight mb-4">
          <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none">
            <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" fill="#25D366" stroke="#25D366" strokeWidth="0.5"/>
          </svg>
          <span>WhatsLater</span>
        </div>
        <p className="text-white/50 mb-12">Promemoria WhatsApp automatici, dal tuo numero.</p>

        <div className="flex flex-wrap justify-center gap-8 text-sm font-medium text-white/60 mb-16">
          <a href="/privacy" className="hover:text-white transition-colors">Privacy Policy</a>
          <a href="/terms" className="hover:text-white transition-colors">Termini di Servizio</a>
          <a href="mailto:supporto@whatslaterpush.vercel.app" className="hover:text-white transition-colors">Contatti</a>
        </div>

        <div className="text-xs text-white/30 space-y-2">
          <p>Made in Italy - Hosted on EU servers</p>
          <p>Copyright &copy; 2026 WhatsLater</p>
        </div>
      </div>
    </footer>
  );
}
