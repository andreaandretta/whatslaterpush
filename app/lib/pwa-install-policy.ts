/**
 * iPhone/iPad: NON spingiamo l'installazione sulla schermata Home (per ora).
 *
 * Perché: su iOS l'app aggiunta alla Home ha un suo barattolo di cookie, separato
 * da Safari. Le versioni recenti copiano i cookie di Safari al momento
 * dell'installazione, ma non tutte, e togliere/rimettere l'icona o un reset della
 * web app li perde. Senza `sw_session` l'icona apre /connect; l'utente scrive il
 * suo numero e /api/auth/init risponde 409 "Aprilo dallo stesso browser dove sei
 * già loggato" — impossibile da un'icona. Resta chiuso fuori dall'app installata
 * (serve l'operatore) mentre i promemoria continuano a partire.
 *
 * Finché non è verificato su un iPhone vero che la sessione passa da Safari
 * all'icona (installa → apri l'icona → /api/auth/me = 200), e finché il caso
 * "icona senza cookie" non ha un recupero self-service (OTP, Task 64), il banner
 * e il bottone "Installa" non compaiono su iOS. Chi l'ha già installata non
 * cambia nulla. Verificato il percorso: NEXT_PUBLIC_IOS_INSTALL_VERIFIED=true.
 */
export function iosInstallPromptEnabled(): boolean {
  return process.env.NEXT_PUBLIC_IOS_INSTALL_VERIFIED === 'true';
}

/**
 * Qualsiasi browser su iPhone/iPad (Safari, Chrome, Firefox iOS usano tutti
 * WebKit e dal 16.4 possono aggiungere alla Home), iPad in modalità desktop incluso.
 */
export function isAppleMobileDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  return /Macintosh/.test(ua) && (navigator.maxTouchPoints || 0) > 1;
}

/** true = su questo dispositivo NON proponiamo l'installazione. */
export function hideInstallOnThisDevice(ios: boolean): boolean {
  return (ios || isAppleMobileDevice()) && !iosInstallPromptEnabled();
}
