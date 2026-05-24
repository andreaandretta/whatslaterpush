'use client';
import Link from 'next/link';

// Case-study style hero — replaces the previous dark-green hero entirely.
// White background with subtle WA doodle pattern, giant typography (Programma…),
// and two inline 3D phones (back: dashboard mock, front: time picker signature).
//
// Layout:
//   Desktop  → 2-column grid: copy on left, phones cluster on right
//   Mobile   → single column: title, sub, CTA, then phones stacked below
//
// The phone screens are pure CSS/SVG — no images required.
export default function HeroSection() {
  return (
    <section className="relative min-h-screen flex items-center justify-center bg-white overflow-hidden pt-20 pb-16 wa-doodle">
      <div className="max-w-6xl mx-auto px-6 grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-12 lg:gap-16 items-center w-full">
        {/* === LEFT: copy === */}
        <div className="text-center lg:text-left">
          <span className="inline-flex items-center gap-2 bg-[#A8E6CF] text-[#075E54] px-3 py-1.5 rounded-full text-xs font-bold mb-6">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
            Per chi vive di WhatsApp
          </span>

          <h1 className="font-heading text-5xl sm:text-6xl lg:text-7xl font-black text-[#1A1F2C] leading-[1.02] tracking-tight">
            <span className="text-[#4FBE7C]">Programma</span>
            <br />
            i messaggi <span className="text-[#4FBE7C]">WhatsApp</span>
          </h1>

          <p className="mt-6 text-base sm:text-lg text-[#5A6573] leading-relaxed max-w-xl mx-auto lg:mx-0">
            Programma i messaggi che <strong className="text-[#1A1F2C]">dimentichi sempre di mandare</strong> &mdash; o quelli che <strong className="text-[#1A1F2C]">ripeti ogni settimana</strong> alle stesse persone.{' '}
            <strong className="text-[#1A1F2C]">Dal tuo numero personale</strong>, anche quando non ci sei.
          </p>

          <div className="mt-8 flex items-center justify-center lg:justify-start gap-4 flex-wrap">
            <Link
              href="/connect"
              className="inline-flex items-center gap-2 bg-primary text-white px-7 h-14 rounded-full text-base font-bold shadow-2xl shadow-primary/30 hover:bg-primary-hover transition-colors"
            >
              Inizia gratis
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="5" y1="12" x2="19" y2="12" />
                <polyline points="12 5 19 12 12 19" />
              </svg>
            </Link>
            <span className="text-sm text-[#5A6573]">In 2 minuti &middot; Niente carta</span>
          </div>
        </div>

        {/* === RIGHT: 2 phones cluster === */}
        <PhonesCluster />
      </div>
    </section>
  );
}

// Stacked 3D phones: back rotated -10° showing dashboard, front rotated +8°
// showing the case-study signature time picker. Pure CSS, no images.
function PhonesCluster() {
  return (
    <div className="relative w-[260px] sm:w-[290px] h-[330px] sm:h-[360px] mx-auto">
      {/* BACK phone — dashboard mock */}
      <div className="absolute top-0 left-[4%] w-[155px] sm:w-[165px] h-[295px] sm:h-[315px] bg-[#1a1d1f] rounded-[26px] p-1.5 shadow-2xl shadow-black/30 -rotate-[10deg] z-10">
        <div className="w-full h-full bg-white rounded-[22px] p-3 flex flex-col gap-2 overflow-hidden relative">
          <div className="flex items-center gap-1.5 pb-2 border-b border-gray-100 text-[10px] font-extrabold">
            <span className="w-1.5 h-1.5 bg-primary rounded-full"></span>
            WhatsLater
          </div>
          {[
            { i: 'LC', n: 'Luca C.', t: 'Sab · 09:00', b: '2h' },
            { i: 'SQ', n: 'Squadra', t: 'Dom · 18:30', b: '1g' },
            { i: 'MR', n: 'Marco R.', t: 'Lun · 07:00', b: '3g' },
          ].map((m) => (
            <div key={m.i} className="flex items-center gap-1.5 py-0.5">
              <div className="w-5 h-5 rounded-full bg-[#A8E6CF] text-[#075E54] text-[8px] font-extrabold flex items-center justify-center shrink-0">
                {m.i}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[9px] font-bold leading-tight">{m.n}</div>
                <div className="text-[7px] text-gray-400">{m.t}</div>
              </div>
              <span className="bg-amber-100 text-amber-700 text-[8px] font-extrabold px-1.5 py-0.5 rounded-full">{m.b}</span>
            </div>
          ))}
          {/* mini FAB */}
          <div className="absolute bottom-2 right-2 w-7 h-7 bg-primary rounded-full flex items-center justify-center shadow-lg shadow-primary/40">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="white">
              <path d="M2 21l21-9L2 3v7l15 2-15 2v7z" />
            </svg>
          </div>
        </div>
      </div>

      {/* FRONT phone — time picker signature */}
      <div className="absolute top-9 right-0 w-[155px] sm:w-[165px] h-[295px] sm:h-[315px] bg-[#1a1d1f] rounded-[26px] p-1.5 shadow-2xl shadow-black/30 rotate-[8deg] z-20">
        <div className="w-full h-full bg-[#E8F8F0] rounded-[22px] p-3 flex flex-col">
          <div className="text-[10px] font-extrabold text-center mb-2">Programma invio</div>
          <div className="bg-white rounded-md py-1.5 px-2 text-[9px] font-bold text-center mb-2 shadow-sm">
            Sab 24 maggio
          </div>
          <div className="flex gap-1 mb-2.5">
            <div className="flex-1 bg-white rounded-md py-2.5 px-1 text-center shadow-sm">
              <div className="text-2xl font-black leading-none tracking-tight">09</div>
              <div className="text-[5.5px] uppercase tracking-widest text-gray-500 font-extrabold mt-0.5">Ore</div>
            </div>
            <div className="flex items-center font-black text-lg">:</div>
            <div className="flex-1 bg-white rounded-md py-2.5 px-1 text-center shadow-sm">
              <div className="text-2xl font-black leading-none tracking-tight">00</div>
              <div className="text-[5.5px] uppercase tracking-widest text-gray-500 font-extrabold mt-0.5">Min</div>
            </div>
            <div className="bg-white rounded-md w-5 flex flex-col overflow-hidden shadow-sm">
              <div className="flex-1 flex items-center justify-center text-[7px] font-extrabold bg-[#A8E6CF] text-[#075E54]">AM</div>
              <div className="flex-1 flex items-center justify-center text-[7px] font-extrabold text-gray-400">PM</div>
            </div>
          </div>
          <div className="mt-auto bg-primary text-white rounded-full py-1.5 text-center text-[8px] font-extrabold shadow-md shadow-primary/40">
            Programma &rarr;
          </div>
        </div>
      </div>
    </div>
  );
}
