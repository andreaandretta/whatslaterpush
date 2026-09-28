/**
 * @jest-environment jsdom
 *
 * Tasto Indietro con una modale aperta: deve chiudere lo strato in cima, non
 * l'app. Prima nessuna modale scriveva in cronologia: la PWA parte con una sola
 * voce (/dashboard), quindi Indietro chiudeva l'app e il messaggio spariva.
 */
import React, { useState } from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { useModalHistory, openModalLayerCount, __resetModalHistoryForTests } from '../app/lib/use-modal-history';

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 15)); });

async function pressBack() {
  await act(async () => {
    window.history.back();
    await new Promise((r) => setTimeout(r, 15));
  });
}

function Layer({ name, open, onBack }: { name: string; open: boolean; onBack: () => boolean | void }) {
  useModalHistory(open, onBack);
  return open ? <div data-testid={`layer-${name}`} /> : null;
}

function Harness({ vetoSheet = false }: { vetoSheet?: boolean }) {
  const [picker, setPicker] = useState(false);
  const [modal, setModal] = useState(false);
  const [sheet, setSheet] = useState(false);
  return (
    <div>
      <button onClick={() => setPicker(true)}>apri-picker</button>
      <button onClick={() => { setPicker(false); setModal(true); }}>scegli-contatto</button>
      <button onClick={() => setModal(false)}>chiudi-modale</button>
      <button onClick={() => setSheet(true)}>apri-foglio</button>
      <Layer name="picker" open={picker} onBack={() => setPicker(false)} />
      <Layer name="modal" open={modal} onBack={() => setModal(false)} />
      <Layer name="sheet" open={sheet} onBack={() => (vetoSheet ? false : setSheet(false))} />
    </div>
  );
}

beforeEach(() => {
  __resetModalHistoryForTests();
  // Voce di base come la scrive il router di Next.
  window.history.replaceState({ __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: ['tree'] }, '');
});

describe('useModalHistory', () => {
  test('Indietro con la modale aperta chiude la modale e resta sulla pagina', async () => {
    render(<Harness />);
    const startLen = window.history.length;
    fireEvent.click(screen.getByText('scegli-contatto'));
    await flush();
    expect(window.history.length).toBe(startLen + 1);
    // Lo stato interno di Next è copiato: al popstate fa RESTORE, non reload.
    expect(window.history.state).toMatchObject({ __NA: true, __wlModal: 1 });

    await pressBack();
    expect(screen.queryByTestId('layer-modal')).not.toBeInTheDocument();
    expect(window.history.state).toMatchObject({ __NA: true });
    expect(window.history.state.__wlModal).toBeUndefined();
    expect(openModalLayerCount()).toBe(0);
  });

  test('con un foglio sopra la modale, Indietro chiude solo il foglio', async () => {
    render(<Harness />);
    fireEvent.click(screen.getByText('scegli-contatto'));
    fireEvent.click(screen.getByText('apri-foglio'));
    await flush();
    expect(window.history.state.__wlModal).toBe(2);

    await pressBack();
    expect(screen.queryByTestId('layer-sheet')).not.toBeInTheDocument();
    expect(screen.getByTestId('layer-modal')).toBeInTheDocument();

    await pressBack();
    expect(screen.queryByTestId('layer-modal')).not.toBeInTheDocument();
  });

  test('chiudere dai bottoni toglie la voce: nessun Indietro a vuoto dopo', async () => {
    render(<Harness />);
    fireEvent.click(screen.getByText('scegli-contatto'));
    await flush();
    expect(window.history.state.__wlModal).toBe(1);
    fireEvent.click(screen.getByText('chiudi-modale'));
    await flush();
    await flush();
    expect(window.history.state.__wlModal).toBeUndefined();
    expect(window.history.state).toMatchObject({ __NA: true });
  });

  test('ContactPicker → ScheduleModal nello stesso render: la voce passa alla modale', async () => {
    render(<Harness />);
    fireEvent.click(screen.getByText('apri-picker'));
    await flush();
    const len = window.history.length;
    fireEvent.click(screen.getByText('scegli-contatto'));
    await flush();
    await flush();
    // Nessuna voce in più né in meno, e la modale è ancora aperta.
    expect(window.history.length).toBe(len);
    expect(window.history.state.__wlModal).toBe(1);
    expect(screen.getByTestId('layer-modal')).toBeInTheDocument();

    await pressBack();
    expect(screen.queryByTestId('layer-modal')).not.toBeInTheDocument();
  });

  test('uno strato che rifiuta di chiudersi (conferma annullata) si riprende la voce', async () => {
    render(<Harness vetoSheet />);
    fireEvent.click(screen.getByText('scegli-contatto'));
    fireEvent.click(screen.getByText('apri-foglio'));
    await flush();

    await pressBack();
    expect(screen.getByTestId('layer-sheet')).toBeInTheDocument();
    expect(window.history.state.__wlModal).toBe(2);
    expect(openModalLayerCount()).toBe(2);
  });

  test('se il router ha navigato altrove, la pulizia non torna indietro alla cieca', async () => {
    render(<Harness />);
    fireEvent.click(screen.getByText('scegli-contatto'));
    await flush();
    // Il router spinge una pagina nuova (stato senza la nostra chiave).
    window.history.pushState({ __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: ['altra'] }, '');
    const back = jest.spyOn(window.history, 'go');
    fireEvent.click(screen.getByText('chiudi-modale'));
    await flush();
    expect(back).not.toHaveBeenCalled();
    expect(window.history.state.__PRIVATE_NEXTJS_INTERNALS_TREE).toEqual(['altra']);
    back.mockRestore();
  });
});
