/**
 * @jest-environment jsdom
 *
 * Component-level test for ContactPickerModal. Verifies the photo wiring:
 * after Phase 3 the modal must pass `c.photoUrl` (the pps.whatsapp.net URL
 * cached in whatsapp_contacts.profile_pic_url and surfaced by GET
 * /api/contacts) straight to ContactAvatar — no `/api/contacts/[phone]/photo`
 * proxy, no in-flight throttling. Contacts without photoUrl render initials
 * only.
 */
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import ContactPickerModal from '../components/ContactPickerModal';

function mockFetchContacts(contacts: any[], recents: any[] = []) {
  const body = { contacts, recents };
  (global as any).fetch = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
    headers: new Headers(),
  });
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe('ContactPickerModal — photo wiring', () => {
  test('renders <img> with the contact.photoUrl when present', async () => {
    mockFetchContacts([
      { number: '393331111111', name: 'Mario', photoUrl: 'https://pps.whatsapp.net/mario.jpg' },
    ]);

    const { container } = render(
      <ContactPickerModal open={true} onClose={() => {}} onSelect={() => {}} />
    );

    await waitFor(() => {
      expect(screen.getByText('Mario')).toBeInTheDocument();
    });

    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    expect(img!.getAttribute('src')).toBe('https://pps.whatsapp.net/mario.jpg');
  });

  test('renders no <img> when contact has no photoUrl', async () => {
    mockFetchContacts([
      { number: '393332222222', name: 'Anna' },
    ]);

    const { container } = render(
      <ContactPickerModal open={true} onClose={() => {}} onSelect={() => {}} />
    );

    await waitFor(() => {
      expect(screen.getByText('Anna')).toBeInTheDocument();
    });

    expect(container.querySelector('img')).toBeNull();
  });

  test('does not fall back to /api/contacts/[phone]/photo proxy', async () => {
    mockFetchContacts([
      { number: '393333333333', name: 'Luca' },
      { number: '393334444444', name: 'Sara', photoUrl: 'https://pps.whatsapp.net/sara.jpg' },
    ]);

    const { container } = render(
      <ContactPickerModal open={true} onClose={() => {}} onSelect={() => {}} />
    );

    await waitFor(() => {
      expect(screen.getByText('Luca')).toBeInTheDocument();
      expect(screen.getByText('Sara')).toBeInTheDocument();
    });

    const imgs = container.querySelectorAll('img');
    for (const img of Array.from(imgs)) {
      expect(img.getAttribute('src')).not.toMatch(/\/api\/contacts\/.+\/photo/);
    }
  });

  test('mixed list: photoUrl present and missing render correctly', async () => {
    mockFetchContacts([
      { number: '393331111111', name: 'Mario', photoUrl: 'https://pps.whatsapp.net/mario.jpg' },
      { number: '393332222222', name: 'Anna' },
      { number: '393333333333', name: 'Luca', photoUrl: 'https://pps.whatsapp.net/luca.jpg' },
    ]);

    const { container } = render(
      <ContactPickerModal open={true} onClose={() => {}} onSelect={() => {}} />
    );

    await waitFor(() => {
      expect(screen.getByText('Mario')).toBeInTheDocument();
      expect(screen.getByText('Anna')).toBeInTheDocument();
      expect(screen.getByText('Luca')).toBeInTheDocument();
    });

    const imgs = Array.from(container.querySelectorAll('img'));
    expect(imgs.length).toBe(2);
    const srcs = imgs.map(i => i.getAttribute('src')).sort();
    expect(srcs).toEqual([
      'https://pps.whatsapp.net/luca.jpg',
      'https://pps.whatsapp.net/mario.jpg',
    ]);
  });
});

describe('ContactPickerModal — Recenti section', () => {
  test('renders "Recenti" header when API returns recents', async () => {
    mockFetchContacts(
      [{ number: '393331111111', name: 'Mario' }, { number: '393332222222', name: 'Anna' }],
      [{ number: '393331111111', name: 'Mario' }],
    );
    render(<ContactPickerModal open={true} onClose={() => {}} onSelect={() => {}} />);
    await waitFor(() => expect(screen.getByText(/Contatti su WhatsApp/i)).toBeInTheDocument());
    expect(screen.getByText(/^Recenti$/i)).toBeInTheDocument();
  });

  test('does NOT render "Recenti" header when recents is empty', async () => {
    mockFetchContacts([{ number: '393331111111', name: 'Mario' }], []);
    render(<ContactPickerModal open={true} onClose={() => {}} onSelect={() => {}} />);
    await waitFor(() => expect(screen.getByText('Mario')).toBeInTheDocument());
    expect(screen.queryByText(/^Recenti$/i)).not.toBeInTheDocument();
  });

  test('typing in search hides "Recenti" section', async () => {
    mockFetchContacts(
      [{ number: '393331111111', name: 'Mario' }, { number: '393332222222', name: 'Anna' }],
      [{ number: '393331111111', name: 'Mario' }],
    );
    render(<ContactPickerModal open={true} onClose={() => {}} onSelect={() => {}} />);
    await waitFor(() => expect(screen.getByText(/^Recenti$/i)).toBeInTheDocument());
    const searchInput = screen.getByPlaceholderText(/Cerca contatto/i);
    fireEvent.change(searchInput, { target: { value: 'Anna' } });
    expect(screen.queryByText(/^Recenti$/i)).not.toBeInTheDocument();
  });

  test('recent contact appears in both Recenti and alphabetical sections without key collision', async () => {
    mockFetchContacts(
      [{ number: '393331111111', name: 'Mario' }],
      [{ number: '393331111111', name: 'Mario' }],
    );
    render(<ContactPickerModal open={true} onClose={() => {}} onSelect={() => {}} />);
    await waitFor(() => expect(screen.getByText(/^Recenti$/i)).toBeInTheDocument());
    // Mario rendered twice: once under Recenti, once under Contatti
    expect(screen.getAllByText('Mario').length).toBe(2);
  });
});
