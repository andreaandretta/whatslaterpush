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

test('the first choice exits this device only, and says reminders keep going', () => {
  const onConfirm = jest.fn();
  render(<LogoutDialog open pendingCount={3} onCancel={() => {}} onConfirm={onConfirm} />);
  const buttons = screen.getAllByRole('button');
  expect(buttons[0]).toHaveTextContent('Esci da questo dispositivo');
  expect(buttons[0]).toHaveTextContent(/partono lo stesso/);
  fireEvent.click(buttons[0]);
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
