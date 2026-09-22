/**
 * @jest-environment jsdom
 *
 * ContactPickerModal — stale-while-revalidate + render incrementale.
 */
import React from 'react';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import ContactPickerModal from '../components/ContactPickerModal';
import { clearContactsSnapshots, setContactsSnapshot, getContactsSnapshot } from '../app/lib/contacts-client-cache';

function okResponse(body: any) {
  return { ok: true, status: 200, json: () => Promise.resolve(body), headers: new Headers() };
}

afterEach(() => {
  jest.restoreAllMocks();
  clearContactsSnapshots();
});

describe('ContactPickerModal — stale-while-revalidate', () => {
  // Revisione 21 set: il prefetch del dashboard può scrivere la cache MENTRE il fetch
  // del picker è in volo. Se poi quel fetch fallisce, prima restava lo spinner per sempre.
  test('fetch in volo + cache scritta nel frattempo + fetch fallito → mostra la lista, niente spinner infinito', async () => {
    let rejectFetch: (e: Error) => void = () => {};
    (global as any).fetch = jest.fn((url: string) => String(url).startsWith('/api/contacts')
      ? new Promise((_res, rej) => { rejectFetch = rej; })
      : Promise.resolve(okResponse([])));
    render(<ContactPickerModal open={true} onClose={() => {}} onSelect={() => {}} />);
    expect(screen.getByText(/Caricamento contatti/i)).toBeInTheDocument();

    setContactsSnapshot(null, [{ number: '393331111111', name: 'Mario' }], []); // il prefetch arriva ora
    await act(async () => { rejectFetch(new Error('network')); await Promise.resolve(); await Promise.resolve(); });

    await waitFor(() => expect(screen.getByText('Mario')).toBeInTheDocument());
    expect(screen.queryByText(/Caricamento contatti/i)).not.toBeInTheDocument();
  });

  test('una risposta parziale (X-Contacts-Partial) si mostra ma non finisce in cache', async () => {
    (global as any).fetch = jest.fn((url: string) => Promise.resolve(String(url).startsWith('/api/contacts')
      ? { ok: true, status: 200, json: () => Promise.resolve({ contacts: [{ number: '393331111111', name: 'Mario' }], recents: [] }), headers: new Headers({ 'x-contacts-partial': '1' }) }
      : okResponse([])));
    render(<ContactPickerModal open={true} onClose={() => {}} onSelect={() => {}} />);
    await waitFor(() => expect(screen.getByText('Mario')).toBeInTheDocument());
    expect(getContactsSnapshot(null)).toBeNull();
  });

  test('alla riapertura mostra subito la lista in cache, senza spinner, anche se il fetch non risponde', async () => {
    (global as any).fetch = jest.fn().mockResolvedValue(okResponse({ contacts: [{ number: '393331111111', name: 'Mario' }], recents: [] }));
    const { rerender } = render(<ContactPickerModal open={true} onClose={() => {}} onSelect={() => {}} />);
    await waitFor(() => expect(screen.getByText('Mario')).toBeInTheDocument());

    rerender(<ContactPickerModal open={false} onClose={() => {}} onSelect={() => {}} />);
    (global as any).fetch = jest.fn().mockReturnValue(new Promise(() => {})); // non risponde mai
    rerender(<ContactPickerModal open={true} onClose={() => {}} onSelect={() => {}} />);

    expect(screen.getByText('Mario')).toBeInTheDocument();
    expect(screen.queryByText(/Caricamento contatti/i)).not.toBeInTheDocument();
    // la revalidate parte comunque (l'altro fetch è /api/labels del LabelPicker)
    const contactCalls = ((global as any).fetch as jest.Mock).mock.calls.filter((c) => String(c[0]).startsWith('/api/contacts'));
    expect(contactCalls.length).toBe(1);
  });

  test('la revalidate sostituisce la lista vecchia con quella nuova', async () => {
    (global as any).fetch = jest.fn().mockResolvedValue(okResponse({ contacts: [{ number: '393331111111', name: 'Mario' }], recents: [] }));
    const { rerender } = render(<ContactPickerModal open={true} onClose={() => {}} onSelect={() => {}} />);
    await waitFor(() => expect(screen.getByText('Mario')).toBeInTheDocument());

    rerender(<ContactPickerModal open={false} onClose={() => {}} onSelect={() => {}} />);
    (global as any).fetch = jest.fn().mockResolvedValue(okResponse({ contacts: [{ number: '393332222222', name: 'Anna' }], recents: [] }));
    rerender(<ContactPickerModal open={true} onClose={() => {}} onSelect={() => {}} />);

    await waitFor(() => expect(screen.getByText('Anna')).toBeInTheDocument());
    expect(screen.queryByText('Mario')).not.toBeInTheDocument();
  });

  test('se la revalidate fallisce la lista in cache resta (niente "Sto sincronizzando")', async () => {
    (global as any).fetch = jest.fn().mockResolvedValue(okResponse({ contacts: [{ number: '393331111111', name: 'Mario' }], recents: [] }));
    const { rerender } = render(<ContactPickerModal open={true} onClose={() => {}} onSelect={() => {}} />);
    await waitFor(() => expect(screen.getByText('Mario')).toBeInTheDocument());

    rerender(<ContactPickerModal open={false} onClose={() => {}} onSelect={() => {}} />);
    (global as any).fetch = jest.fn().mockRejectedValue(new Error('network'));
    rerender(<ContactPickerModal open={true} onClose={() => {}} onSelect={() => {}} />);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(screen.getByText('Mario')).toBeInTheDocument();
    expect(screen.queryByText(/Sto sincronizzando/i)).not.toBeInTheDocument();
  });

  test('senza cache un errore di rete porta ancora a "Sto sincronizzando" con Riprova', async () => {
    (global as any).fetch = jest.fn().mockRejectedValue(new Error('network'));
    render(<ContactPickerModal open={true} onClose={() => {}} onSelect={() => {}} />);
    await waitFor(() => expect(screen.getByText(/Sto sincronizzando/i)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /Riprova/i })).toBeInTheDocument();
  });

  test("l'abort del cleanup (chiusura a fetch in volo) NON porta a \"Sto sincronizzando\"", async () => {
    // fetch che rigetta con AbortError quando il signal viene abortito, come il browser
    (global as any).fetch = jest.fn().mockImplementation((_url: string, init: any) => new Promise((_res, rej) => {
      init.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    }));
    const { rerender } = render(<ContactPickerModal open={true} onClose={() => {}} onSelect={() => {}} />);
    rerender(<ContactPickerModal open={false} onClose={() => {}} onSelect={() => {}} />);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    (global as any).fetch = jest.fn().mockReturnValue(new Promise(() => {}));
    rerender(<ContactPickerModal open={true} onClose={() => {}} onSelect={() => {}} />);
    expect(screen.queryByText(/Sto sincronizzando/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Caricamento contatti/i)).toBeInTheDocument();
  });
});

describe('ContactPickerModal — render incrementale', () => {
  const many = Array.from({ length: 500 }, (_, i) => ({ number: '39333' + String(1000000 + i), name: 'Contatto ' + String(i).padStart(3, '0') }));

  test('monta solo la prima pagina ma il contatore dice il totale', async () => {
    (global as any).fetch = jest.fn().mockResolvedValue(okResponse({ contacts: many, recents: [] }));
    render(<ContactPickerModal open={true} onClose={() => {}} onSelect={() => {}} />);
    await waitFor(() => expect(screen.getByText('Contatti su WhatsApp (500)')).toBeInTheDocument());
    expect(screen.getAllByText(/^Contatto \d{3}$/).length).toBe(60);
    expect(screen.getByRole('button', { name: /Mostra altri \(440\)/i })).toBeInTheDocument();
  });

  test('la ricerca trova anche un contatto NON ancora montato', async () => {
    (global as any).fetch = jest.fn().mockResolvedValue(okResponse({ contacts: many, recents: [] }));
    render(<ContactPickerModal open={true} onClose={() => {}} onSelect={() => {}} />);
    await waitFor(() => expect(screen.getByText('Contatto 000')).toBeInTheDocument());
    expect(screen.queryByText('Contatto 499')).not.toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText(/Cerca contatto/i), { target: { value: 'contatto 499' } });
    expect(screen.getByText('Contatto 499')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Mostra altri/i })).not.toBeInTheDocument();
  });

  test('la ricerca per numero trova anche oltre la prima pagina', async () => {
    (global as any).fetch = jest.fn().mockResolvedValue(okResponse({ contacts: many, recents: [] }));
    render(<ContactPickerModal open={true} onClose={() => {}} onSelect={() => {}} />);
    await waitFor(() => expect(screen.getByText('Contatto 000')).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText(/Cerca contatto/i), { target: { value: '1000450' } });
    expect(screen.getByText('Contatto 450')).toBeInTheDocument();
  });

  test('"Mostra altri" monta la pagina successiva', async () => {
    (global as any).fetch = jest.fn().mockResolvedValue(okResponse({ contacts: many, recents: [] }));
    render(<ContactPickerModal open={true} onClose={() => {}} onSelect={() => {}} />);
    await waitFor(() => expect(screen.getByText('Contatto 000')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Mostra altri/i }));
    expect(screen.getAllByText(/^Contatto \d{3}$/).length).toBe(120);
  });

  test('il tap su una riga chiama onSelect con numero e nome', async () => {
    const onSelect = jest.fn();
    (global as any).fetch = jest.fn().mockResolvedValue(okResponse({ contacts: many.slice(0, 3), recents: [] }));
    render(<ContactPickerModal open={true} onClose={() => {}} onSelect={onSelect} />);
    await waitFor(() => expect(screen.getByText('Contatto 001')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Contatto 001'));
    expect(onSelect).toHaveBeenCalledWith({ number: '393331000001', name: 'Contatto 001' });
  });
});
