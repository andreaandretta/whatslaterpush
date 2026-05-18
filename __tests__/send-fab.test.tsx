/**
 * @jest-environment jsdom
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { SendFab } from '../components/schedule/SendFab';

describe('SendFab', () => {
  test('renders with aria-label Invia', () => {
    render(<SendFab disabled={false} loading={false} onClick={() => {}} />);
    expect(screen.getByRole('button', { name: /Invia/i })).toBeInTheDocument();
  });

  test('calls onClick when clicked', () => {
    const onClick = jest.fn();
    render(<SendFab disabled={false} loading={false} onClick={onClick} />);
    fireEvent.click(screen.getByRole('button', { name: /Invia/i }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  test('does not call onClick when disabled', () => {
    const onClick = jest.fn();
    render(<SendFab disabled={true} loading={false} onClick={onClick} />);
    fireEvent.click(screen.getByRole('button', { name: /Invia/i }));
    expect(onClick).not.toHaveBeenCalled();
  });

  test('does not call onClick when loading', () => {
    const onClick = jest.fn();
    render(<SendFab disabled={false} loading={true} onClick={onClick} />);
    fireEvent.click(screen.getByRole('button', { name: /Invia/i }));
    expect(onClick).not.toHaveBeenCalled();
  });
});
