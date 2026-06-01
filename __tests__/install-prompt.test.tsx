/**
 * @jest-environment jsdom
 */
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import InstallPrompt from '../app/components/InstallPrompt';

const FIRST_MSG_FLAG = 'wl_first_msg_done';
const DISMISSED_FLAG = 'wl_install_dismissed';

// Synthesizes a beforeinstallprompt event (Chrome/Android only API in real
// browsers; we just need the shape the component reads).
function fireBeforeInstallPrompt() {
  const event = new Event('beforeinstallprompt') as Event & {
    prompt?: jest.Mock;
    userChoice?: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
    platforms?: string[];
  };
  event.platforms = ['web'];
  event.prompt = jest.fn().mockResolvedValue(undefined);
  event.userChoice = Promise.resolve({ outcome: 'accepted', platform: 'web' });
  window.dispatchEvent(event);
  return event;
}

describe('InstallPrompt — visibility gating', () => {
  beforeEach(() => {
    localStorage.clear();
    // Reset standalone signal so each test starts unstaged.
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: (q: string) => ({
        matches: false,
        media: q,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
        onchange: null,
      }),
    });
  });

  test('non monta finché wl_first_msg_done non è settato', () => {
    render(<InstallPrompt />);
    act(() => { fireBeforeInstallPrompt(); });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  test('appare quando flag è già settato + arriva beforeinstallprompt', () => {
    localStorage.setItem(FIRST_MSG_FLAG, '1');
    render(<InstallPrompt />);
    act(() => { fireBeforeInstallPrompt(); });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(/Aggiungi alla schermata Home/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Aggiungi/i })).toBeInTheDocument();
  });

  test('reagisce all\'evento wl-first-msg-done quando il flag arriva post-mount', () => {
    render(<InstallPrompt />);
    act(() => { fireBeforeInstallPrompt(); });
    expect(screen.queryByRole('dialog')).toBeNull();

    act(() => {
      localStorage.setItem(FIRST_MSG_FLAG, '1');
      window.dispatchEvent(new Event('wl-first-msg-done'));
    });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  test('"Più tardi" persiste dismissal in localStorage + nasconde banner', () => {
    localStorage.setItem(FIRST_MSG_FLAG, '1');
    render(<InstallPrompt />);
    act(() => { fireBeforeInstallPrompt(); });

    fireEvent.click(screen.getByRole('button', { name: /Più tardi/i }));
    expect(localStorage.getItem(DISMISSED_FLAG)).toBe('1');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  test('non monta se già dismesso, anche con flag + evento attivi', () => {
    localStorage.setItem(FIRST_MSG_FLAG, '1');
    localStorage.setItem(DISMISSED_FLAG, '1');
    render(<InstallPrompt />);
    act(() => { fireBeforeInstallPrompt(); });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
