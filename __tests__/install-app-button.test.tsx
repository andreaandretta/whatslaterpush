/**
 * @jest-environment jsdom
 */
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';

// Control the install-state hook directly so we can exercise each platform path.
jest.mock('../app/hooks/useInstallPrompt', () => ({
  useInstallPrompt: jest.fn(),
}));
import { useInstallPrompt } from '../app/hooks/useInstallPrompt';
import InstallAppButton from '../app/components/InstallAppButton';

const mockHook = useInstallPrompt as unknown as jest.Mock;

const base = {
  mounted: true,
  installed: false,
  deferred: null as unknown,
  ios: false,
  desktopMode: false,
  install: jest.fn(async () => 'accepted' as const),
};

describe('InstallAppButton — iOS install bottom sheet', () => {
  beforeEach(() => {
    mockHook.mockReset();
    document.body.style.overflow = '';
  });

  test('su iOS il bottone resta visibile anche con deferred null', () => {
    mockHook.mockReturnValue({ ...base, ios: true, deferred: null });
    render(<InstallAppButton />);
    expect(screen.getByRole('button', { name: /Installa/i })).toBeInTheDocument();
  });

  test('tap apre un bottom sheet portato su <body>, ancorato in basso + safe-area', () => {
    mockHook.mockReturnValue({ ...base, ios: true, deferred: null });
    render(<InstallAppButton />);
    fireEvent.click(screen.getByRole('button', { name: /Installa/i }));

    const dialog = screen.getByRole('dialog');
    // Portaled to <body> → escapes the navbar's backdrop-filter containing block.
    expect(dialog.parentElement).toBe(document.body);
    expect(dialog).toHaveClass('fixed', 'inset-0', 'z-[80]');

    // The panel IS a bottom sheet: bottom-anchored + iPhone home-bar safe-area.
    const panel = dialog.querySelector('.rounded-t-2xl') as HTMLElement;
    expect(panel).not.toBeNull();
    expect(panel.className).toContain('bottom-0');
    expect(panel.className).toContain('env(safe-area-inset-bottom)');

    // iOS copy + readable steps (the whole point: not clipped behind the status bar).
    expect(screen.getByText(/Installa WhatsLater su iPhone/i)).toBeInTheDocument();
    expect(screen.getByText('Condividi')).toBeInTheDocument();
    expect(screen.getByText(/Aggiungi a Home/i)).toBeInTheDocument();
  });

  test('overlay tap e "Ho capito" chiudono il sheet', () => {
    mockHook.mockReturnValue({ ...base, ios: true, deferred: null });
    render(<InstallAppButton />);
    fireEvent.click(screen.getByRole('button', { name: /Installa/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Ho capito'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  test('standalone (installed) → non renderizza né bottone né sheet', () => {
    mockHook.mockReturnValue({ ...base, installed: true });
    const { container } = render(<InstallAppButton />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  test('Android (deferred presente) → tap lancia il prompt nativo, niente sheet', async () => {
    const install = jest.fn(async () => 'accepted' as const);
    mockHook.mockReturnValue({ ...base, ios: false, deferred: {}, install });
    render(<InstallAppButton />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Installa/i }));
    });
    expect(install).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
