/**
 * @jest-environment jsdom
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { DarkCalendarDialog } from '../components/schedule/DarkCalendarDialog';

describe('DarkCalendarDialog', () => {
  const may15 = new Date(2026, 4, 15);

  test('renders nothing when closed', () => {
    const { container } = render(
      <DarkCalendarDialog open={false} onClose={() => {}} value={may15} onConfirm={() => {}} />
    );
    expect(container.firstChild).toBeNull();
  });

  test('renders the month of the selected date in Italian when open', () => {
    render(
      <DarkCalendarDialog open={true} onClose={() => {}} value={may15} onConfirm={() => {}} />
    );
    expect(screen.getByText(/maggio 2026/i)).toBeInTheDocument();
  });

  test('past days are disabled when minDate is today', () => {
    const today = new Date(2026, 4, 11);
    render(
      <DarkCalendarDialog
        open={true}
        onClose={() => {}}
        value={today}
        minDate={today}
        onConfirm={() => {}}
      />
    );
    expect(screen.getByRole('button', { name: /^5$/ })).toBeDisabled();
  });

  test('forward arrow advances to next month', () => {
    render(
      <DarkCalendarDialog open={true} onClose={() => {}} value={may15} onConfirm={() => {}} />
    );
    fireEvent.click(screen.getByLabelText(/mese successivo/i));
    expect(screen.getByText(/giugno 2026/i)).toBeInTheDocument();
  });

  test('clicking OK emits the picked date', () => {
    const onConfirm = jest.fn();
    const fixedMin = new Date(2026, 0, 1);
    render(
      <DarkCalendarDialog
        open={true}
        onClose={() => {}}
        value={may15}
        minDate={fixedMin}
        onConfirm={onConfirm}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /^20$/ }));
    fireEvent.click(screen.getByRole('button', { name: /^OK$/i }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    const picked = onConfirm.mock.calls[0][0] as Date;
    expect(picked.getFullYear()).toBe(2026);
    expect(picked.getMonth()).toBe(4);
    expect(picked.getDate()).toBe(20);
  });

  test('clicking Annulla calls onClose without confirm', () => {
    const onConfirm = jest.fn();
    const onClose = jest.fn();
    render(
      <DarkCalendarDialog
        open={true}
        onClose={onClose}
        value={may15}
        onConfirm={onConfirm}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /Annulla/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
