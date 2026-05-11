/**
 * @jest-environment jsdom
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MiniCalendar } from '../components/MiniCalendar';

describe('MiniCalendar', () => {
  test('renders the month of the selected date in Italian', () => {
    const may = new Date(2026, 4, 15);
    render(<MiniCalendar selectedDate={may} onChange={() => {}} />);
    expect(screen.getByText(/maggio 2026/i)).toBeInTheDocument();
  });

  test('clicking a future day calls onChange with that date', () => {
    const today = new Date(2026, 4, 11);
    const onChange = jest.fn();
    render(<MiniCalendar selectedDate={today} onChange={onChange} minDate={today} />);

    const btn = screen.getByRole('button', { name: /^20$/ });
    fireEvent.click(btn);

    expect(onChange).toHaveBeenCalledTimes(1);
    const called = onChange.mock.calls[0][0] as Date;
    expect(called.getFullYear()).toBe(2026);
    expect(called.getMonth()).toBe(4);
    expect(called.getDate()).toBe(20);
  });

  test('past days are disabled', () => {
    const today = new Date(2026, 4, 11);
    const onChange = jest.fn();
    render(<MiniCalendar selectedDate={today} onChange={onChange} minDate={today} />);

    const btn = screen.getByRole('button', { name: /^5$/ });
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(onChange).not.toHaveBeenCalled();
  });

  test('forward arrow advances to next month', () => {
    const may = new Date(2026, 4, 15);
    render(<MiniCalendar selectedDate={may} onChange={() => {}} />);
    fireEvent.click(screen.getByLabelText(/mese successivo/i));
    expect(screen.getByText(/giugno 2026/i)).toBeInTheDocument();
  });
});
