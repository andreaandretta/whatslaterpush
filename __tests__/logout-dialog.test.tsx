/**
 * @jest-environment jsdom
 *
 * Dialogo "Disconnetti": dice la verità (dopo il logout nessun messaggio
 * parte) e, con una coda, chiede cosa farne — di default in pausa.
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { LogoutDialog } from '../app/dashboard/LogoutDialog';

test('closed → nothing rendered', () => {
  const { container } = render(<LogoutDialog open={false} pendingCount={3} onCancel={() => {}} onConfirm={() => {}} />);
  expect(container).toBeEmptyDOMElement();
});

test('with a queue it asks what to do, and the first choice pauses', () => {
  const onConfirm = jest.fn();
  render(<LogoutDialog open pendingCount={3} onCancel={() => {}} onConfirm={onConfirm} />);
  expect(screen.getByText('Hai 3 messaggi in coda. Cosa ne faccio?')).toBeInTheDocument();
  expect(screen.getByText(/nessun messaggio parte/)).toBeInTheDocument();
  expect(screen.queryByText(/partono COMUNQUE/)).not.toBeInTheDocument();
  const buttons = screen.getAllByRole('button');
  expect(buttons[0]).toHaveTextContent('Mettili in pausa e disconnetti');
  fireEvent.click(buttons[0]);
  expect(onConfirm).toHaveBeenCalledWith('pause');
});

test('cancel and keep are explicit choices; "Resta collegato" does nothing', () => {
  const onConfirm = jest.fn();
  const onCancel = jest.fn();
  render(<LogoutDialog open pendingCount={1} onCancel={onCancel} onConfirm={onConfirm} />);
  expect(screen.getByText('Hai 1 messaggio in coda. Cosa ne faccio?')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Annullali e disconnetti/ }));
  fireEvent.click(screen.getByRole('button', { name: /Lasciali in coda e disconnetti/ }));
  expect(onConfirm.mock.calls.map((c) => c[0])).toEqual(['cancel', 'keep']);
  fireEvent.click(screen.getByRole('button', { name: 'Resta collegato' }));
  expect(onCancel).toHaveBeenCalled();
});

test('empty queue: a single "Disconnetti"', () => {
  const onConfirm = jest.fn();
  render(<LogoutDialog open pendingCount={0} onCancel={() => {}} onConfirm={onConfirm} />);
  expect(screen.queryByText(/Cosa ne faccio/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Disconnetti' }));
  expect(onConfirm).toHaveBeenCalledWith('pause');
});
