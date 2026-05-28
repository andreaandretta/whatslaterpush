'use client';
import Link from 'next/link';

// Hero v4 — WhatsApp-native single-screen layout for ICP D (allenatore /
// parroco / scout / istruttore). The "scheduled → sent" chip is the hero,
// the chat bubble shows a real coach-style message, and the only saturated
// green on the page is the "Inizia gratis" CTA. Spec: sprint5/HERO-SPEC-FINAL.html
// North-star mockup: sprint5/hero-v4-final.html.
export default function HeroSection() {
  return (
    <section className="relative bg-white pt-16 pb-12 sm:pt-20 sm:pb-16">
      <div className="max-w-6xl mx-auto px-5 sm:px-8 grid grid-cols-1 lg:grid-cols-[1.1fr_1fr] gap-10 lg:gap-16 items-center">
        {/* === LEFT (mobile: top): copy + bullets + CTA === */}
        <div className="text-[#1A1F2C]">
          <span className="inline-flex items-center gap-1.5 bg-[#F0F2F5] text-[#54656F] px-2.5 py-1 rounded-full text-[11px] font-semibold mb-4">
            <span className="w-1.5 h-1.5 rounded-full bg-[#25D366]"></span>
            Per chi gestisce un gruppo WhatsApp
          </span>

          <h1 className="font-heading text-[28px] sm:text-4xl lg:text-5xl font-black leading-[1.06] tracking-tight">
            I messaggi che <span className="text-[#4FBE7C]">dimentichi</span> di mandare, partono da soli.
          </h1>

          <p className="mt-3 text-[15px] sm:text-base lg:text-lg text-[#5A6573] leading-relaxed">
            Partono <strong className="text-[#1A1F2C]">dal tuo numero</strong>, all&apos;ora che scegli tu.
          </p>

          <ul className="mt-4 space-y-2 text-sm sm:text-base font-medium">
            {[
              'Scrivi oggi, parte quando vuoi tu',
              'Dal tuo numero, non da un mittente strano',
              'Pronto in 2 minuti, senza installare niente',
            ].map((b) => (
              <li key={b} className="flex items-center gap-2.5">
                <span className="w-5 h-5 rounded-full bg-[#EAECEF] text-[#54656F] flex items-center justify-center text-xs font-black shrink-0">
                  ✓
                </span>
                <span>{b}</span>
              </li>
            ))}
          </ul>

          <div className="mt-7">
            <Link
              href="/connect"
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 bg-primary text-white px-7 h-12 rounded-full text-base font-bold shadow-lg shadow-primary/30 hover:bg-primary-hover transition-colors"
            >
              Inizia gratis
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="5" y1="12" x2="19" y2="12" />
                <polyline points="12 5 19 12 12 19" />
              </svg>
            </Link>
            <p className="text-center sm:text-left text-[12px] text-[#5A6573] mt-2">
              In 2 minuti · Niente carta
            </p>
            <a
              href="#come-funziona"
              className="mt-3 w-full sm:w-auto inline-flex items-center justify-center sm:justify-start gap-1.5 text-[#075E54] text-sm font-semibold py-2"
            >
              Come funziona
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="12" y1="5" x2="12" y2="19" />
                <polyline points="19 12 12 19 5 12" />
              </svg>
            </a>
          </div>
        </div>

        {/* === RIGHT (mobile: bottom): WhatsApp chat preview card === */}
        <ChatPreview />
      </div>
    </section>
  );
}

function ChatPreview() {
  return (
    <div className="w-full max-w-[420px] mx-auto rounded-3xl overflow-hidden shadow-2xl ring-1 ring-black/5 bg-white">
      {/* Header — verde scuro WhatsApp */}
      <div className="bg-[#075E54] px-4 py-3 flex items-center gap-2.5">
        <svg className="w-5 h-5 text-white/90 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <polyline points="15 18 9 12 15 6" />
        </svg>
        <div className="w-9 h-9 rounded-full bg-white/20 text-white flex items-center justify-center shrink-0">
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
            <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5s-3 1.34-3 3 1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-white text-sm font-semibold leading-tight">Gruppo Allenamento</div>
          <div className="text-white/70 text-[11px]">18 partecipanti</div>
        </div>
        <svg className="w-4 h-4 text-white/80" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="12" cy="5" r="1.6" />
          <circle cx="12" cy="12" r="1.6" />
          <circle cx="12" cy="19" r="1.6" />
        </svg>
      </div>

      {/* Wallpaper + chip eroe + bolla + caption */}
      <div className="wa-classic px-4 pt-5 pb-6">
        {/* Chip "Programmato → Inviato" — IL prodotto, in cima alla chat */}
        <div className="hero-pop flex justify-center mb-5">
          <div className="inline-flex items-center gap-2 bg-white text-[#075E54] text-[12px] font-bold px-3.5 py-2 rounded-2xl shadow-lg ring-1 ring-[#075E54]/10">
            <span className="flex items-center gap-1.5">
              <svg className="w-4 h-4 text-[#8696A0]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <circle cx="12" cy="12" r="9" />
                <path d="M12 7v5l3 2" />
              </svg>
              Programmato
            </span>
            <svg className="w-3.5 h-3.5 text-[#4FBE7C]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            <span className="text-[#4FBE7C]">Inviato 09:00</span>
          </div>
        </div>

        {/* Bolla outbound coach-style */}
        <div className="hero-float flex justify-end">
          <div className="max-w-[80%] bg-[#DCF8C6] text-[#111B21] rounded-2xl rounded-tr-sm px-3 py-2 shadow-sm">
            <p className="text-[13px] leading-snug">
              Ci vediamo domani alle <strong>18:00</strong> al campo per l&apos;allenamento. Ricordatevi la borraccia! 💪
            </p>
            <div className="flex items-center justify-end gap-1 mt-1">
              <span className="text-[10px] text-[#667781]">09:00</span>
              <svg className="w-4 h-4" viewBox="0 0 18 18" fill="none">
                <path d="M2 9.5l3 3 6-7" stroke="#53BDEB" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M6.5 9.5l3 3 6-7" stroke="#53BDEB" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
          </div>
        </div>

        <p className="text-center text-[11px] text-[#667781] mt-4 font-medium">
          L&apos;hai scritto <strong>ieri sera</strong>. È partito da solo stamattina.
        </p>
      </div>
    </div>
  );
}
