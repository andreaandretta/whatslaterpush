'use client';

import React from 'react';
import { useModalHistory } from '../lib/use-modal-history';

export type LogoutChoice = 'device' | 'pause' | 'cancel' | 'keep';

// --- Logout dialog ---
// Due azioni distinte (fase 1b). Prima esisteva solo "Disconnetti", che
// scollegava WhatsApp: chi "usciva" a fine giornata da un PC condiviso, come da
// qualunque sito, fermava tutti i promemoria senza saperlo.
//  - "Esci da questo dispositivo": solo il cookie, i promemoria continuano.
//  - "Scollega WhatsApp": scollega davvero; con una coda chiede cosa farne, e
//    la scelta evidenziata è la pausa (nessuna sorpresa a un ricollegamento
//    futuro, settimane dopo, con promemoria di eventi già passati).
// Per rientrare, in entrambi i casi, oggi serve il supporto (il recupero
// self-service con codice non esiste ancora): il testo lo dice.
// La scelta principale (verde, in alto) è "Resta collegato": prima il verde era
// "Esci", e un tocco per sbaglio chiudeva fuori (rapporto 360, T6). "Puoi
// chiudere la pagina" vale solo per il proprio telefono: su un computer di
// altri la sessione resterebbe aperta per mesi (cookie di 395 giorni).
export function LogoutDialog({ open, pendingCount, onCancel, onConfirm }: {
  open: boolean;
  pendingCount: number;
  onCancel: () => void;
  onConfirm: (choice: LogoutChoice) => void;
}) {
  // Indietro chiude solo questa finestra, come "Resta collegato" (rapporto 360, T13).
  useModalHistory(open, onCancel);
  if (!open) return null;
  const n = pendingCount;
  const btn = 'w-full rounded-xl px-4 py-3 text-sm font-semibold text-left transition-colors';
  // Con la coda le scelte sono tante: su un telefono piccolo la finestra scorre
  // da sola (non la pagina sotto) e l'ultima scelta resta sopra la barretta.
  return (
    <div className="wl-viewport z-modal bg-black/60 flex items-end sm:items-center justify-center" onClick={onCancel} data-testid="logout-overlay">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="logout-title"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-h-full overflow-y-auto overscroll-contain sm:max-w-sm sm:mx-4 bg-[#1F2C33] border border-[#2A3942] rounded-t-2xl sm:rounded-2xl p-5 pb-safe space-y-3"
      >
        <h2 id="logout-title" className="text-white font-bold text-lg">Vuoi uscire?</h2>
        <p className="text-sm text-gray-300 leading-snug">
          Sul tuo telefono non serve uscire: puoi chiudere la pagina. Su un computer non tuo, esci da questo dispositivo. Se esci, per rientrare dovrai scriverci.
        </p>
        <button type="button" onClick={onCancel} className={`${btn} text-center bg-primary text-[#0B141A] hover:opacity-90`}>
          Resta collegato
        </button>
        <button type="button" onClick={() => onConfirm('device')} className={`${btn} bg-white/[0.06] text-white hover:bg-white/10`}>
          Esci da questo dispositivo
          <span className="block text-xs font-normal text-gray-400">
            WhatsApp resta collegato: i messaggi programmati partono lo stesso.
          </span>
        </button>

        <div className="pt-2 border-t border-[#2A3942] space-y-3">
          <p className="text-sm text-gray-300 leading-snug pt-2">
            Oppure scollega WhatsLater dal tuo WhatsApp: <strong className="text-white">nessun messaggio parte</strong> finché non lo ricolleghi, e per ricollegarlo dovrai scriverci.
          </p>
          {n > 0 ? (
            <>
              <p className="text-sm text-white font-semibold">
                Hai {n} messagg{n === 1 ? 'io' : 'i'} in coda. Cosa ne faccio?
              </p>
              <button type="button" onClick={() => onConfirm('pause')} className={`${btn} bg-white/[0.06] text-white hover:bg-white/10`}>
                Mettili in pausa e scollega
                <span className="block text-xs font-normal opacity-80">Quando ricolleghi li riprendi tu, uno per uno.</span>
              </button>
              <button type="button" onClick={() => onConfirm('cancel')} className={`${btn} bg-white/[0.06] text-red-300 hover:bg-white/10`}>
                Annullali e scollega
                <span className="block text-xs font-normal text-gray-400">Solo quest{n === 1 ? 'o' : 'i'} {n}: quelli già in pausa restano in pausa.</span>
              </button>
              <button type="button" onClick={() => onConfirm('keep')} className={`${btn} bg-white/[0.06] text-gray-200 hover:bg-white/10`}>
                Lasciali in coda e scollega
                <span className="block text-xs font-normal text-gray-400">Partiranno appena ricolleghi, anche se in ritardo.</span>
              </button>
            </>
          ) : (
            <button type="button" onClick={() => onConfirm('pause')} className={`${btn} bg-white/[0.06] text-red-300 hover:bg-white/10`}>
              Scollega WhatsApp
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
