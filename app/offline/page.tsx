import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Offline — WhatsLater',
  description: 'Sei offline. I messaggi programmati partono comunque dal server.',
};

export default function OfflinePage() {
  return (
    <div className="min-h-screen bg-[#111B21] text-white font-sans flex items-center justify-center px-6">
      <div className="max-w-md w-full text-center space-y-6">
        <div className="w-16 h-16 mx-auto rounded-full bg-[#202C33] border border-[#2A3942] flex items-center justify-center">
          <svg
            aria-hidden
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="w-8 h-8 text-[#25D366]"
          >
            <path d="M3 3l18 18" />
            <path d="M10.66 5.05A11 11 0 0 1 21.5 8" />
            <path d="M2.5 8a11 11 0 0 1 3.6-2.55" />
            <path d="M6.26 11.26a7 7 0 0 1 5-1.84" />
            <path d="M12 20h.01" />
            <path d="M17 13a5 5 0 0 0-3-1.78" />
          </svg>
        </div>

        <div className="space-y-2">
          <h1 className="text-2xl font-bold tracking-tight">Sei offline</h1>
          <p className="text-gray-400 leading-relaxed">
            I messaggi che hai già programmato partono comunque dal server
            all’orario stabilito. Quando torni online riapri WhatsLater per
            programmarne di nuovi.
          </p>
        </div>

        <Link
          href="/dashboard"
          className="inline-block bg-[#25D366] text-white font-semibold rounded-full px-6 py-3 hover:bg-[#1ebe5b] transition-colors"
        >
          Riprova
        </Link>
      </div>
    </div>
  );
}
