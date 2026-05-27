/**
 * @jest-environment jsdom
 */
import React from 'react';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import { DeliveryStatusIcon } from '../app/components/DeliveryStatusIcon';

describe('DeliveryStatusIcon — tri-state UI', () => {
  test('renders nothing when status is pending (no sent_at yet)', () => {
    const { container } = render(
      <DeliveryStatusIcon msg={{ status: 'pending' }} />
    );
    expect(container.firstChild).toBeNull();
  });

  test('renders single ✓ in gray when status=sent and no receipt', () => {
    const { getByLabelText, container } = render(
      <DeliveryStatusIcon msg={{ status: 'sent', sent_at: '2026-05-27T08:00:00Z' }} />
    );
    expect(getByLabelText('Inviato')).toBeInTheDocument();
    expect(container.querySelector('[data-testid="status-sent"]')).toBeInTheDocument();
    expect(container.querySelector('[data-testid="status-delivered"]')).not.toBeInTheDocument();
  });

  test('renders ✓✓ gray when delivered_at present but not read', () => {
    const { getByLabelText, container } = render(
      <DeliveryStatusIcon msg={{
        status: 'sent',
        sent_at: '2026-05-27T08:00:00Z',
        delivered_at: '2026-05-27T08:00:30Z',
      }} />
    );
    expect(getByLabelText('Consegnato')).toBeInTheDocument();
    expect(container.querySelector('[data-testid="status-delivered"]')).toBeInTheDocument();
  });

  test('renders ✓✓ sky-blue when read_at present (highest precedence)', () => {
    const { getByLabelText, container } = render(
      <DeliveryStatusIcon msg={{
        status: 'sent',
        sent_at: '2026-05-27T08:00:00Z',
        delivered_at: '2026-05-27T08:00:30Z',
        read_at: '2026-05-27T08:05:00Z',
      }} />
    );
    expect(getByLabelText('Letto')).toBeInTheDocument();
    expect(container.querySelector('[data-testid="status-read"]')).toBeInTheDocument();
    // sky-blue text color — SVG className is SVGAnimatedString, use classList
    const svg = container.querySelector('svg');
    expect(svg?.classList.contains('text-sky-400')).toBe(true);
  });

  test('read_at wins over delivered_at + status=sent', () => {
    // Even if only read_at is set (delivered_at missing) — read implies delivered;
    // UI should still show the read state.
    const { getByLabelText } = render(
      <DeliveryStatusIcon msg={{ status: 'sent', read_at: '2026-05-27T08:05:00Z' }} />
    );
    expect(getByLabelText('Letto')).toBeInTheDocument();
  });

  test('tooltip on read state includes formatted time', () => {
    const { container } = render(
      <DeliveryStatusIcon msg={{ status: 'sent', read_at: '2026-05-27T08:05:00Z' }} />
    );
    const span = container.querySelector('[data-testid="status-read"]');
    expect(span?.getAttribute('title')).toMatch(/^Letto \d{2}:\d{2}$/);
  });
});
