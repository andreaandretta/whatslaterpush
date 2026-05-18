/**
 * @jest-environment jsdom
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { AnalogClockDialog } from '../components/schedule/AnalogClockDialog';

describe('AnalogClockDialog', () => {
  test('renders nothing when closed', () => {
    const { container } = render(
      <AnalogClockDialog open={false} onClose={() => {}} value="15:00" onConfirm={() => {}} />
    );
    expect(container.firstChild).toBeNull();
  });

  test('renders the current value in the tracker when open', () => {
    render(
      <AnalogClockDialog open={true} onClose={() => {}} value="15:30" onConfirm={() => {}} />
    );
    expect(screen.getByTestId('clock-hour')).toHaveTextContent('15');
    expect(screen.getByTestId('clock-minute')).toHaveTextContent('30');
  });

  test('starts in hour phase: hour tracker is active, hour nodes are clickable', () => {
    render(
      <AnalogClockDialog open={true} onClose={() => {}} value="15:00" onConfirm={() => {}} />
    );
    expect(screen.getByTestId('clock-hour')).toHaveClass('text-primary');
    expect(screen.getByTestId('clock-node-0')).toBeInTheDocument();
    expect(screen.getByTestId('clock-node-23')).toBeInTheDocument();
  });

  test('clicking an hour node updates the hour and advances to minute phase', () => {
    render(
      <AnalogClockDialog open={true} onClose={() => {}} value="15:00" onConfirm={() => {}} />
    );
    fireEvent.click(screen.getByTestId('clock-node-7'));
    expect(screen.getByTestId('clock-hour')).toHaveTextContent('7');
    expect(screen.getByTestId('clock-minute')).toHaveClass('text-primary');
    expect(screen.getByTestId('clock-node-0')).toBeInTheDocument();
    expect(screen.getByTestId('clock-node-55')).toBeInTheDocument();
  });

  test('clicking a minute node updates the minute (does not auto-confirm)', () => {
    const onConfirm = jest.fn();
    render(
      <AnalogClockDialog open={true} onClose={() => {}} value="15:00" onConfirm={onConfirm} />
    );
    fireEvent.click(screen.getByTestId('clock-node-7'));
    fireEvent.click(screen.getByTestId('clock-node-25'));
    expect(screen.getByTestId('clock-minute')).toHaveTextContent('25');
    expect(onConfirm).not.toHaveBeenCalled();
  });

  test('OK emits HH:MM with zero padding', () => {
    const onConfirm = jest.fn();
    render(
      <AnalogClockDialog open={true} onClose={() => {}} value="15:00" onConfirm={onConfirm} />
    );
    fireEvent.click(screen.getByTestId('clock-node-7'));
    fireEvent.click(screen.getByTestId('clock-node-5'));
    fireEvent.click(screen.getByRole('button', { name: /^OK$/i }));
    expect(onConfirm).toHaveBeenCalledWith('07:05');
  });

  test('clicking hour tracker switches back to hour phase', () => {
    render(
      <AnalogClockDialog open={true} onClose={() => {}} value="15:00" onConfirm={() => {}} />
    );
    fireEvent.click(screen.getByTestId('clock-node-7'));
    expect(screen.getByTestId('clock-minute')).toHaveClass('text-primary');
    fireEvent.click(screen.getByTestId('clock-hour'));
    expect(screen.getByTestId('clock-hour')).toHaveClass('text-primary');
    expect(screen.getByTestId('clock-node-0')).toBeInTheDocument();
    expect(screen.getByTestId('clock-node-23')).toBeInTheDocument();
  });

  test('Annulla closes without confirming', () => {
    const onConfirm = jest.fn();
    const onClose = jest.fn();
    render(
      <AnalogClockDialog open={true} onClose={onClose} value="15:00" onConfirm={onConfirm} />
    );
    fireEvent.click(screen.getByRole('button', { name: /Annulla/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
