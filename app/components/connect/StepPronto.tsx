'use client';

import Logo from '@/components/Logo';

// Step 3 — bridge screen between light Connect and dark Dashboard.
// • Animated check-pop on entry (cubic-bezier bouncy)
// • Two concentric rings expanding outward (ripple style — matches FAB)
// • Auto-redirect happens in parent (app/connect/page.tsx) after 1.5s
//
// The dark-green palette is intentional: it sits between the light Connect
// flow and the dark dashboard so the eye isn't shocked by a hard white→black
// transition. Linear/Notion-style "you're in the app now" moment.
export default function StepPronto() {
  return (
    <div className="relative min-h-screen bg-gradient-to-b from-[#075E54] to-[#054C44] text-white flex flex-col items-center justify-center overflow-hidden px-6 text-center">
      {/* Brand mark anchored top — same as the other two steps */}
      <div className="absolute top-6 left-1/2 -translate-x-1/2 z-20">
        <Logo size={20} variant="onDark" ringColor="#075E54" />
      </div>

      {/* Expanding rings */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="w-60 h-60 rounded-full border border-white/10 animate-[pronto-ring_2.6s_ease-out_infinite]" />
      </div>
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div
          className="w-60 h-60 rounded-full border border-white/10 animate-[pronto-ring_2.6s_ease-out_infinite]"
          style={{ animationDelay: '1.3s' }}
        />
      </div>

      {/* Check badge */}
      <div className="relative z-10 w-28 h-28 bg-primary rounded-full flex items-center justify-center mb-7 shadow-[0_0_0_14px_rgba(37,211,102,0.18),0_0_0_28px_rgba(37,211,102,0.10)] animate-[pronto-pop_0.6s_cubic-bezier(0.34,1.56,0.64,1)]">
        <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </div>

      <div className="relative z-10 text-[11px] uppercase tracking-widest font-extrabold text-[#A8E6CF] mb-2.5">
        Pairing completato
      </div>
      <h1 className="relative z-10 text-4xl sm:text-5xl font-black tracking-tight leading-tight mb-2.5">
        Sei <span className="text-[#A8E6CF]">dentro</span> 👋
      </h1>
      <p className="relative z-10 text-white/75 mb-8 max-w-xs">
        Stiamo aprendo la tua dashboard.
      </p>

      {/* Shimmer loader bar */}
      <div className="relative z-10 w-24 h-1 bg-white/10 rounded-full overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-[#A8E6CF] to-transparent animate-[pronto-slide_1.4s_linear_infinite]" />
      </div>

      <style jsx>{`
        @keyframes pronto-pop {
          0% { transform: scale(0); }
          100% { transform: scale(1); }
        }
        @keyframes pronto-ring {
          0% { transform: scale(0.4); opacity: 0.8; }
          100% { transform: scale(1.6); opacity: 0; }
        }
        @keyframes pronto-slide {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
      `}</style>
    </div>
  );
}
