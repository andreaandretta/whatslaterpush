/**
 * @jest-environment jsdom
 */
import { shouldShowOnboardingHints, markOnboardingDone } from '../components/onboarding/OnboardingTour';

beforeEach(() => {
  localStorage.clear();
});

describe('shouldShowOnboardingHints / markOnboardingDone', () => {
  test('returns true on a fresh storage', () => {
    expect(shouldShowOnboardingHints()).toBe(true);
  });

  test('returns false once marked done', () => {
    markOnboardingDone();
    expect(shouldShowOnboardingHints()).toBe(false);
  });

  test('persists across calls (localStorage)', () => {
    markOnboardingDone();
    expect(localStorage.getItem('whatslater_onboarding_completed')).toBe('true');
  });
});
