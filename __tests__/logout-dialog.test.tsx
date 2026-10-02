/**
 * @jest-environment jsdom
 *
 * Dialogo di uscita (fase 1b): due azioni distinte.
 * - "Esci da questo dispositivo": solo il cookie, i promemoria continuano.
 * - "Scollega WhatsApp": scollega davvero (nessun messaggio parte) e, con una
 *   coda, chiede cosa farne — di default in pausa.
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { LogoutDialog } from '../app/dashboard/LogoutDialog';

test('closed → nothing rendered', () => {
  const { container } = render(<LogoutDialog open={false} pendingCount={3} onCancel={() => {}} onConfirm={() => {}} />);
  expect(container).toBeEmptyDOMElement();
});

test('"Resta collegato" is the first and only green choice; it does not exit', () => {
  const onConfirm = jest.fn();
  const onCancel = jest.fn();
  render(<LogoutDialog open pendingCount={3} onCancel={onCancel} onConfirm={onConfirm} />);
  const buttons = screen.getAllByRole('button');
  expect(buttons[0]).toHaveTextContent('Resta collegato');
  expect(buttons[0].className).toMatch(/\bbg-primary\b/);
  expect(buttons[0].className).toMatch(/text-\[#0B141A\]/);
  buttons.slice(1).forEach((b) => expect(b.className).not.toMatch(/\bbg-primary\b/));
  expect(screen.getByText(/Sul tuo telefono non serve uscire: puoi chiudere la pagina\./)).toBeInTheDocument();
  expect(screen.getByText(/Se esci, per rientrare dovrai scriverci\./)).toBeInTheDocument();
  fireEvent.click(buttons[0]);
  expect(onCancel).toHaveBeenCalled();
  expect(onConfirm).not.toHaveBeenCalled();
});

// Revisione: "puoi chiudere la pagina" non deve valere per il PC della parrocchia.
test('on a computer that is not yours the text says to exit this device', () => {
  render(<LogoutDialog open pendingCount={0} onCancel={() => {}} onConfirm={() => {}} />);
  expect(screen.getByText(/Su un computer non tuo, esci da questo dispositivo\./)).toBeInTheDocument();
  expect(screen.queryByText(/Di solito non serve uscire/)).not.toBeInTheDocument();
});

test('the device exit is secondary, exits this device only, and says reminders keep going', () => {
  const onConfirm = jest.fn();
  render(<LogoutDialog open pendingCount={3} onCancel={() => {}} onConfirm={onConfirm} />);
  const exit = screen.getByRole('button', { name: /Esci da questo dispositivo/ });
  expect(exit).toHaveTextContent(/partono lo stesso/);
  fireEvent.click(exit);
  expect(onConfirm).toHaveBeenCalledWith('device');
});

test('unlinking WhatsApp is a separate, explicit action that states the consequence', () => {
  const onConfirm = jest.fn();
  render(<LogoutDialog open pendingCount={3} onCancel={() => {}} onConfirm={onConfirm} />);
  expect(screen.getByText(/nessun messaggio parte/)).toBeInTheDocument();
  expect(screen.getByText('Hai 3 messaggi in coda. Cosa ne faccio?')).toBeInTheDocument();
  expect(screen.queryByText(/partono COMUNQUE/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Mettili in pausa e scollega/ }));
  expect(onConfirm).toHaveBeenCalledWith('pause');
});

test('cancel and keep are explicit choices; "Resta collegato" does nothing', () => {
  const onConfirm = jest.fn();
  const onCancel = jest.fn();
  render(<LogoutDialog open pendingCount={1} onCancel={onCancel} onConfirm={onConfirm} />);
  expect(screen.getByText('Hai 1 messaggio in coda. Cosa ne faccio?')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Annullali e scollega/ }));
  fireEvent.click(screen.getByRole('button', { name: /Lasciali in coda e scollega/ }));
  expect(onConfirm.mock.calls.map((c) => c[0])).toEqual(['cancel', 'keep']);
  fireEvent.click(screen.getByRole('button', { name: 'Resta collegato' }));
  expect(onCancel).toHaveBeenCalled();
});

test('"Annullali" names only the queued messages; paused ones are not touched', () => {
  render(<LogoutDialog open pendingCount={2} onCancel={() => {}} onConfirm={() => {}} />);
  expect(screen.getByRole('button', { name: /Annullali e scollega/ })).toHaveTextContent(/in pausa restano in pausa/);
});

test('empty queue: a single "Scollega WhatsApp" besides the device exit', () => {
  const onConfirm = jest.fn();
  render(<LogoutDialog open pendingCount={0} onCancel={() => {}} onConfirm={onConfirm} />);
  expect(screen.queryByText(/Cosa ne faccio/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Scollega WhatsApp' }));
  expect(onConfirm).toHaveBeenCalledWith('pause');
});
