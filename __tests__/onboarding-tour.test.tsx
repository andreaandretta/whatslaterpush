/**
 * @jest-environment jsdom
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { OnboardingTour, shouldShowOnboarding, markOnboardingDone } from '../components/onboarding/OnboardingTour';

beforeEach(() => {
  localStorage.clear();
});

describe('shouldShowOnboarding / markOnboardingDone', () => {
  test('returns true on a fresh storage', () => {
    expect(shouldShowOnboarding()).toBe(true);
  });

  test('returns false once marked done', () => {
    markOnboardingDone();
    expect(shouldShowOnboarding()).toBe(false);
  });

  test('persists across calls (localStorage)', () => {
    markOnboardingDone();
    expect(localStorage.getItem('whatslater_onboarding_completed')).toBe('true');
  });
});

describe('OnboardingTour — render lifecycle', () => {
  test('renders welcome step on first mount when storage empty', () => {
    render(<OnboardingTour contactPickerOpen={false} scheduleModalOpen={false} />);
    expect(screen.getByText('Ciao!')).toBeInTheDocument();
    expect(screen.getByText('Mostrami')).toBeInTheDocument();
    expect(screen.getByText('Salta')).toBeInTheDocument();
  });

  test('does NOT render when onboarding already completed', () => {
    markOnboardingDone();
    const { container } = render(<OnboardingTour contactPickerOpen={false} scheduleModalOpen={false} />);
    expect(container.firstChild).toBeNull();
  });

  test('"Salta" closes the tour and marks it completed', () => {
    const onComplete = jest.fn();
    render(<OnboardingTour contactPickerOpen={false} scheduleModalOpen={false} onComplete={onComplete} />);
    fireEvent.click(screen.getByText('Salta'));
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('whatslater_onboarding_completed')).toBe('true');
    expect(screen.queryByText('Ciao!')).not.toBeInTheDocument();
  });

  test('"Mostrami" advances from welcome to FAB step (fallback hint when no FAB present)', () => {
    render(<OnboardingTour contactPickerOpen={false} scheduleModalOpen={false} />);
    fireEvent.click(screen.getByText('Mostrami'));
    // Welcome dismissed
    expect(screen.queryByText('Ciao!')).not.toBeInTheDocument();
    // FAB hint fallback (no [data-onboarding-target="fab"] in jsdom DOM)
    expect(screen.getByText(/Manda messaggio/)).toBeInTheDocument();
  });
});

describe('OnboardingTour — auto-advance on modal state', () => {
  test('advances from FAB to contact-picker step when contactPickerOpen flips true', () => {
    const { rerender } = render(<OnboardingTour contactPickerOpen={false} scheduleModalOpen={false} />);
    fireEvent.click(screen.getByText('Mostrami'));
    // Now we're on the FAB step (fallback shown because no FAB in DOM).
    rerender(<OnboardingTour contactPickerOpen={true} scheduleModalOpen={false} />);
    expect(screen.getByText(/Scegli a chi mandare/)).toBeInTheDocument();
  });

  test('advances from contact-picker to schedule-modal step when scheduleModalOpen flips true', () => {
    const { rerender } = render(<OnboardingTour contactPickerOpen={false} scheduleModalOpen={false} />);
    fireEvent.click(screen.getByText('Mostrami'));
    rerender(<OnboardingTour contactPickerOpen={true} scheduleModalOpen={false} />);
    rerender(<OnboardingTour contactPickerOpen={true} scheduleModalOpen={true} />);
    expect(screen.getByText(/Template/)).toBeInTheDocument();
  });

  test('"Fatto!" on schedule-modal step finishes the tour', () => {
    const onComplete = jest.fn();
    const { rerender } = render(<OnboardingTour contactPickerOpen={false} scheduleModalOpen={false} onComplete={onComplete} />);
    fireEvent.click(screen.getByText('Mostrami'));
    rerender(<OnboardingTour contactPickerOpen={true} scheduleModalOpen={false} onComplete={onComplete} />);
    rerender(<OnboardingTour contactPickerOpen={true} scheduleModalOpen={true} onComplete={onComplete} />);
    fireEvent.click(screen.getByText('Fatto!'));
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('whatslater_onboarding_completed')).toBe('true');
  });
});

describe('OnboardingTour — skip at any step', () => {
  test('skip from FAB step (fallback "Ho capito") completes the tour', () => {
    const onComplete = jest.fn();
    render(<OnboardingTour contactPickerOpen={false} scheduleModalOpen={false} onComplete={onComplete} />);
    fireEvent.click(screen.getByText('Mostrami'));
    fireEvent.click(screen.getByText('Ho capito'));
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('whatslater_onboarding_completed')).toBe('true');
  });
});
