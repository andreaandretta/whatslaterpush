// Onboarding state — used to be a multi-step tour with overlay+spotlight
// (welcome modal, FAB spotlight, idle prompt, tip banners). Sprint 5 Cluster F
// reduced it to two pure functions; the in-product hints now live as inline
// affordances in the dashboard (MessagesEmptyState + FAB pulse ring).

const STORAGE_KEY = 'whatslater_onboarding_completed';
const STORAGE_VALUE_DONE = 'true';

export function shouldShowOnboardingHints(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return localStorage.getItem(STORAGE_KEY) !== STORAGE_VALUE_DONE;
  } catch {
    // Some privacy-mode browsers throw on localStorage access — skip hints.
    return false;
  }
}

export function markOnboardingDone() {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, STORAGE_VALUE_DONE);
  } catch {}
}
