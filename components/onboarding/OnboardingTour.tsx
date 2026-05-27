'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { X, Sparkles } from 'lucide-react';

const STORAGE_KEY = 'whatslater_onboarding_completed';
const STORAGE_VALUE_DONE = 'true';
const IDLE_PROMPT_MS = 30_000;

type Step = 'welcome' | 'fab' | 'contact-picker' | 'schedule-modal';
const STEP_ORDER: Step[] = ['welcome', 'fab', 'contact-picker', 'schedule-modal'];

interface BoxRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

interface OnboardingTourProps {
  // Pass true when the relevant modal is open so the tour can advance.
  // Dashboard reports its modal state up; tour reads it and progresses.
  contactPickerOpen: boolean;
  scheduleModalOpen: boolean;
  onComplete?: () => void;
}

// Helper: skip tour for users who already completed it. Returns null in SSR.
export function shouldShowOnboarding(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return localStorage.getItem(STORAGE_KEY) !== STORAGE_VALUE_DONE;
  } catch {
    // Some privacy-mode browsers throw on localStorage access — skip tour.
    return false;
  }
}

export function markOnboardingDone() {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, STORAGE_VALUE_DONE);
  } catch {}
}

export function OnboardingTour({ contactPickerOpen, scheduleModalOpen, onComplete }: OnboardingTourProps) {
  const [active, setActive] = useState(false);
  const [step, setStep] = useState<Step>('welcome');
  const [idlePromptVisible, setIdlePromptVisible] = useState(false);

  // Activate on mount if not yet completed.
  useEffect(() => {
    if (shouldShowOnboarding()) setActive(true);
  }, []);

  const finish = useCallback(() => {
    markOnboardingDone();
    setActive(false);
    setIdlePromptVisible(false);
    onComplete?.();
  }, [onComplete]);

  const advance = useCallback(() => {
    setIdlePromptVisible(false);
    const idx = STEP_ORDER.indexOf(step);
    if (idx < 0 || idx >= STEP_ORDER.length - 1) {
      finish();
    } else {
      setStep(STEP_ORDER[idx + 1]);
    }
  }, [step, finish]);

  // Auto-advance based on actual modal state. The user IS doing the action
  // the tour is highlighting — recognize it and move on.
  useEffect(() => {
    if (!active) return;
    if (step === 'fab' && contactPickerOpen) {
      setStep('contact-picker');
      setIdlePromptVisible(false);
    } else if (step === 'contact-picker' && scheduleModalOpen) {
      setStep('schedule-modal');
      setIdlePromptVisible(false);
    }
  }, [active, step, contactPickerOpen, scheduleModalOpen]);

  // Idle prompt — if the user sits on a step >30s without progress, ask
  // "Vuoi continuare?" rather than blocking the screen forever.
  useEffect(() => {
    if (!active) return;
    const id = setTimeout(() => setIdlePromptVisible(true), IDLE_PROMPT_MS);
    return () => clearTimeout(id);
  }, [active, step]);

  // Spotlight target rect for the FAB step. Recomputed on resize.
  const [fabRect, setFabRect] = useState<BoxRect | null>(null);
  useEffect(() => {
    if (!active || step !== 'fab') {
      setFabRect(null);
      return;
    }
    const update = () => {
      const el = document.querySelector('[data-onboarding-target="fab"]') as HTMLElement | null;
      if (!el) {
        setFabRect(null);
        return;
      }
      const r = el.getBoundingClientRect();
      setFabRect({ top: r.top, left: r.left, width: r.width, height: r.height });
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update);
    };
  }, [active, step]);

  if (!active) return null;

  if (step === 'welcome') {
    return (
      <Overlay>
        <div className="bg-[#1F2C33] rounded-2xl max-w-sm w-full mx-4 p-6 text-white shadow-2xl">
          <div className="flex items-start gap-3 mb-3">
            <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
              <Sparkles className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">Ciao!</h2>
              <p className="text-gray-300 text-sm mt-1">
                WhatsLater programma messaggi dal tuo numero. 30 secondi per il primo messaggio.
              </p>
            </div>
          </div>
          <div className="flex gap-2 mt-5">
            <button
              type="button"
              onClick={finish}
              className="flex-1 py-2 rounded-xl text-gray-400 hover:bg-white/5"
            >
              Salta
            </button>
            <button
              type="button"
              onClick={advance}
              className="flex-1 py-2 rounded-xl bg-primary text-white font-medium hover:bg-primary/90"
            >
              Mostrami
            </button>
          </div>
        </div>
      </Overlay>
    );
  }

  if (step === 'fab') {
    return (
      <FabSpotlight rect={fabRect} onSkip={finish} idle={idlePromptVisible} onIdleContinue={() => setIdlePromptVisible(false)} />
    );
  }

  if (step === 'contact-picker') {
    // Render only when the ContactPicker is open — otherwise the user is
    // navigating away and we'd be talking to an empty screen.
    if (!contactPickerOpen) return null;
    return (
      <TipBanner
        text="Scegli a chi mandare il messaggio dalla lista."
        onSkip={finish}
        bottomOffset="bottom-24"
      />
    );
  }

  if (step === 'schedule-modal') {
    if (!scheduleModalOpen) return null;
    return (
      <TipBanner
        text="Apri 'Opzioni avanzate' → Template per usare un testo pronto per il tuo ruolo."
        onSkip={finish}
        onClose={finish}
        bottomOffset="bottom-24"
        closeLabel="Fatto!"
      />
    );
  }

  return null;
}

function Overlay({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70"
      role="dialog"
      aria-modal="true"
    >
      {children}
    </div>
  );
}

function FabSpotlight({
  rect,
  onSkip,
  idle,
  onIdleContinue,
}: {
  rect: BoxRect | null;
  onSkip: () => void;
  idle: boolean;
  onIdleContinue: () => void;
}) {
  // If we can't find the FAB (e.g. dashboard loading), fall back to a
  // centered hint pointing to the bottom-right.
  if (!rect) {
    return (
      <Overlay>
        <div className="bg-[#1F2C33] rounded-2xl max-w-sm mx-4 p-6 text-white shadow-2xl">
          <p className="text-sm text-gray-200">
            Cerca il bottone <strong>"Manda messaggio"</strong> in basso a destra per iniziare.
          </p>
          <button
            type="button"
            onClick={onSkip}
            className="mt-4 w-full py-2 rounded-xl bg-primary text-white font-medium"
          >
            Ho capito
          </button>
        </div>
      </Overlay>
    );
  }

  // Spotlight: dark backdrop with a transparent circle around the FAB.
  // Position the tooltip ABOVE the FAB so it doesn't go off-screen.
  const pad = 12;
  const radius = Math.max(rect.width, rect.height) / 2 + pad;
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  const tooltipBottom = window.innerHeight - rect.top + 16;

  return (
    <div className="fixed inset-0 z-[80] pointer-events-none" role="dialog" aria-modal="true">
      <svg className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <mask id="onboarding-spotlight-mask">
            <rect width="100%" height="100%" fill="white" />
            <circle cx={centerX} cy={centerY} r={radius} fill="black" />
          </mask>
        </defs>
        <rect
          width="100%"
          height="100%"
          fill="rgba(0,0,0,0.75)"
          mask="url(#onboarding-spotlight-mask)"
        />
      </svg>
      <div
        className="absolute right-6 max-w-[240px] pointer-events-auto"
        style={{ bottom: `${tooltipBottom}px` }}
      >
        <div className="bg-primary text-white rounded-2xl shadow-2xl p-4 text-sm font-medium">
          Tocca qui per iniziare
        </div>
        <button
          type="button"
          onClick={onSkip}
          className="mt-2 text-xs text-gray-300 underline pointer-events-auto"
        >
          Salta tour
        </button>
      </div>

      {idle && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-auto">
          <div className="bg-[#1F2C33] rounded-2xl max-w-xs mx-4 p-5 text-white shadow-2xl text-center">
            <p className="text-sm mb-4">Vuoi continuare il tour?</p>
            <div className="flex gap-2">
              <button type="button" onClick={onSkip} className="flex-1 py-2 rounded-xl text-gray-400 hover:bg-white/5">
                Esci
              </button>
              <button type="button" onClick={onIdleContinue} className="flex-1 py-2 rounded-xl bg-primary text-white font-medium">
                Continua
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TipBanner({
  text,
  onSkip,
  onClose,
  bottomOffset,
  closeLabel,
}: {
  text: string;
  onSkip: () => void;
  onClose?: () => void;
  bottomOffset: string;
  closeLabel?: string;
}) {
  return (
    <div className={`fixed left-1/2 -translate-x-1/2 ${bottomOffset} z-[80] w-[calc(100%-2rem)] sm:w-auto sm:max-w-md`}>
      <div className="bg-primary text-white rounded-2xl shadow-2xl p-4 flex items-start gap-3">
        <Sparkles className="w-5 h-5 shrink-0 mt-0.5" />
        <p className="text-sm font-medium flex-1">{text}</p>
        <button
          type="button"
          onClick={onClose || onSkip}
          aria-label="Chiudi tour"
          className="p-1 rounded-full hover:bg-white/10 shrink-0"
        >
          {closeLabel ? <span className="text-xs font-bold px-2">{closeLabel}</span> : <X className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
}
