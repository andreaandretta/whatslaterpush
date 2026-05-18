/**
 * @jest-environment jsdom
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ReminderBottomSheet } from '../components/schedule/ReminderBottomSheet';

describe('ReminderBottomSheet', () => {
  test('renders nothing when closed', () => {
    const { container } = render(
      <ReminderBottomSheet open={false} onClose={() => {}} value="never" onChange={() => {}} />
    );
    expect(container.firstChild).toBeNull();
  });

  test('renders all 5 options when open', () => {
    render(<ReminderBottomSheet open={true} onClose={() => {}} value="never" onChange={() => {}} />);
    expect(screen.getByText(/15 minuti prima/i)).toBeInTheDocument();
    expect(screen.getByText(/30 minuti prima/i)).toBeInTheDocument();
    expect(screen.getByText(/1 ora prima/i)).toBeInTheDocument();
    expect(screen.getByText(/1 giorno prima/i)).toBeInTheDocument();
    expect(screen.getByText(/^Mai$/i)).toBeInTheDocument();
  });

  test('clicking a row calls onChange with the value and onClose', () => {
    const onChange = jest.fn();
    const onClose = jest.fn();
    render(<ReminderBottomSheet open={true} onClose={onClose} value="never" onChange={onChange} />);
    fireEvent.click(screen.getByText(/1 ora prima/i));
    expect(onChange).toHaveBeenCalledWith('1h');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('clicking backdrop calls onClose without changing value', () => {
    const onChange = jest.fn();
    const onClose = jest.fn();
    render(<ReminderBottomSheet open={true} onClose={onClose} value="never" onChange={onChange} />);
    fireEvent.click(screen.getByTestId('reminder-backdrop'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
  });
});
