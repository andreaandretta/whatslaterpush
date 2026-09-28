'use client';

import React from 'react';

// --- Logout dialog ---
// Onesto su cosa succede: "Disconnetti" scollega WhatsApp, quindi la coda non
// parte finché non si ricollega. Con messaggi in coda chiede cosa farne; la
// scelta evidenziata è metterli in pausa (nessuna sorpresa a un ricollegamento
// futuro, settimane dopo, con promemoria di eventi già passati).
export function LogoutDialog({ open, pendingCount, onCancel, onConfirm }: {
  open: boolean;
  pendingCount: number;
  onCancel: () => void;
  onConfirm: (queue: 'pause' | 'cancel' | 'keep') => void;
}) {
  if (!open) return null;
  const n = pendingCount;
  const btn = 'w-full rounded-xl px-4 py-3 text-sm font-semibold text-left transition-colors';
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center" onClick={onCancel}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="logout-title"
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-sm sm:mx-4 bg-[#1F2C33] border border-[#2A3942] rounded-t-2xl sm:rounded-2xl p-5 space-y-3"
      >
        <h2 id="logout-title" className="text-white font-bold text-lg">Disconnettere WhatsApp?</h2>
        <p className="text-sm text-gray-300 leading-snug">
          Per uscire ti basta chiudere la pagina: finché resti collegato i messaggi partono da soli.
        </p>
        <p className="text-sm text-gray-300 leading-snug">
          Se ti disconnetti, WhatsLater si scollega dal tuo WhatsApp: <strong className="text-white">nessun messaggio parte</strong> finché non lo ricolleghi, e per rientrare dovrai ricollegarlo contattando il supporto.
        </p>
        {n > 0 ? (
          <>
            <p className="text-sm text-white font-semibold pt-1">
              Hai {n} messagg{n === 1 ? 'io' : 'i'} in coda. Cosa ne faccio?
            </p>
            <button type="button" onClick={() => onConfirm('pause')} className={`${btn} bg-primary text-white hover:opacity-90`}>
              Mettili in pausa e disconnetti
              <span className="block text-xs font-normal opacity-80">Quando ricolleghi li riprendi tu, uno per uno.</span>
            </button>
            <button type="button" onClick={() => onConfirm('cancel')} className={`${btn} bg-white/[0.06] text-red-300 hover:bg-white/10`}>
              Annullali e disconnetti
            </button>
            <button type="button" onClick={() => onConfirm('keep')} className={`${btn} bg-white/[0.06] text-gray-200 hover:bg-white/10`}>
              Lasciali in coda e disconnetti
              <span className="block text-xs font-normal text-gray-400">Partiranno appena ricolleghi, anche se in ritardo.</span>
            </button>
          </>
        ) : (
          <button type="button" onClick={() => onConfirm('pause')} className={`${btn} bg-white/[0.06] text-red-300 hover:bg-white/10`}>
            Disconnetti
          </button>
        )}
        <button type="button" onClick={onCancel} className={`${btn} text-center text-gray-400 hover:text-white`}>
          Resta collegato
        </button>
      </div>
    </div>
  );
}
