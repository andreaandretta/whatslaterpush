'use client';

import { useCallback, useEffect, useState } from 'react';

export interface BeforeInstallPromptEvent extends Event {
  readonly platforms: ReadonlyArray<string>;
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

function isStandaloneNow(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.matchMedia?.('(display-mode: standalone)').matches) return true;
  const nav = navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true;
}

function isIosSafari(): boolean {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const ios = /iPad|iPhone|iPod/.test(ua) && !(window as unknown as { MSStream?: unknown }).MSStream;
  if (!ios) return false;
  return /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
}

// Heuristic for a phone/tablet with "Request desktop site" ON. Chrome then
// sends a desktop UA (no "Mobile" token) and SUPPRESSES beforeinstallprompt /
// PWA install entirely, so the native prompt can never fire — no code can
// override it. We detect a coarse (touch) primary pointer + multi-touch + a
// desktop-looking UA, and tell the user to turn Desktop site off (the real fix).
function isDesktopSiteOnTouch(): boolean {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const touch = (navigator.maxTouchPoints || 0) > 1;
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  const looksDesktop = !/Mobile|Android|iPhone|iPad|iPod/i.test(ua);
  return touch && coarse && looksDesktop;
}

export interface UseInstallPromptResult {
  mounted: boolean;
  installed: boolean;
  deferred: BeforeInstallPromptEvent | null;
  ios: boolean;
  desktopMode: boolean;
  install: () => Promise<'accepted' | 'dismissed' | 'unavailable'>;
}

// Single source of truth for PWA install state. Both the dashboard header
// button and the install banner subscribe to it — each call registers its
// own beforeinstallprompt listener, but since every listener preventDefaults
// and stores the event locally, multiple subscribers behave identically to
// a single owner.
//
// We also drain window.__wlBip — captured pre-hydration by the inline
// script in app/layout.tsx — so fast cached loads don't miss the event.
export function useInstallPrompt(): UseInstallPromptResult {
  const [mounted, setMounted] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [ios, setIos] = useState(false);
  const [desktopMode, setDesktopMode] = useState(false);

  useEffect(() => {
    setMounted(true);
    if (isStandaloneNow()) { setInstalled(true); return; }
    setIos(isIosSafari());
    setDesktopMode(isDesktopSiteOnTouch());
    const pre = (window as unknown as { __wlBip?: BeforeInstallPromptEvent }).__wlBip;
    if (pre) setDeferred(pre);
    const onBip = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setDeferred(null);
    };
    window.addEventListener('beforeinstallprompt', onBip);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBip);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const install = useCallback(async (): Promise<'accepted' | 'dismissed' | 'unavailable'> => {
    if (!deferred) return 'unavailable';
    try {
      await deferred.prompt();
      const choice = await deferred.userChoice;
      return choice.outcome;
    } catch {
      return 'dismissed';
    } finally {
      setDeferred(null);
      try { (window as unknown as { __wlBip?: unknown }).__wlBip = null; } catch { /* ignore */ }
    }
  }, [deferred]);

  return { mounted, installed, deferred, ios, desktopMode, install };
}
