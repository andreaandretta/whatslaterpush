/**
 * @jest-environment jsdom
 *
 * Queue list: a message with an attachment must be recognizable while it is
 * still waiting (22 set 2026: a pending message with a photo looked identical
 * to one without).
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import MessagesSection, { AttachmentChip, type ScheduledMessage } from '../app/components/MessagesSection';

const future = new Date(Date.now() + 3 * 3600 * 1000).toISOString();
const noop = () => {};
const props = { onDelete: noop, onDuplicate: noop, onEdit: noop, onPauseToggle: noop, onRetry: noop, onSnooze: noop, onShowToast: noop, connected: true };

function msg(over: Partial<ScheduledMessage>): ScheduledMessage {
  return { id: 'm1', recipient_name: 'Mario Rossi', recipient_number: '393331234567', parsed_message: 'Ciao Mario', scheduled_at: future, status: 'pending', ...over };
}

describe('AttachmentChip', () => {
  test('renders nothing without media', () => {
    const { container } = render(<AttachmentChip msg={{ media_type: null }} />);
    expect(container).toBeEmptyDOMElement();
  });

  test('labels the media kind and shows the filename', () => {
    render(<AttachmentChip msg={{ media_type: 'image', media_filename: 'foto.jpg' }} />);
    const chip = screen.getByTestId('attachment-chip');
    expect(chip).toHaveAttribute('aria-label', 'Allegato: Foto');
    expect(chip).toHaveTextContent('Foto · foto.jpg');
  });
});

describe('MessagesSection — pending row with attachment', () => {
  test('a pending message with a photo shows the attachment chip; one without does not', () => {
    render(<MessagesSection {...props} messages={[
      msg({ id: 'with', media_type: 'image', media_filename: 'foto.jpg' }),
      msg({ id: 'without', recipient_name: 'Luigi Verdi' }),
    ]} />);
    const chips = screen.getAllByTestId('attachment-chip');
    expect(chips).toHaveLength(1);
    expect(chips[0]).toHaveTextContent('Foto');
  });

  test('a media-only message (no text) still shows what it carries', () => {
    render(<MessagesSection {...props} messages={[msg({ parsed_message: '', media_type: 'document', media_filename: 'orari.pdf' })]} />);
    expect(screen.getByTestId('attachment-chip')).toHaveTextContent('Documento · orari.pdf');
  });
});

describe('MessagesSection — failed because the number is not on WhatsApp', () => {
  test('no useless "Riprova"; a hint says what to do instead', () => {
    render(<MessagesSection {...props} messages={[msg({ status: 'failed', error_message: 'Evolution API error: 400 - {"exists":false}' })]} />);
    expect(screen.getByText('Numero non su WhatsApp')).toBeInTheDocument();
    expect(screen.getByTestId('invalid-number-hint')).toBeInTheDocument();
    expect(screen.queryByText('Riprova')).not.toBeInTheDocument();
  });

  test('any other 400 (e.g. a timeout wrapped as Bad Request) keeps "Riprova"', () => {
    render(<MessagesSection {...props} messages={[msg({ status: 'failed', error_message: 'HTTP 400: {"status":400,"error":"Bad Request","response":{"message":["Error: Timed Out"]}}' })]} />);
    expect(screen.getByText('Riprova')).toBeInTheDocument();
    expect(screen.queryByTestId('invalid-number-hint')).not.toBeInTheDocument();
  });

  test('other failures keep "Riprova"', () => {
    render(<MessagesSection {...props} messages={[msg({ status: 'failed', error_message: 'Evolution API error: 500 - boom' })]} />);
    expect(screen.getByText('Riprova')).toBeInTheDocument();
    expect(screen.queryByTestId('invalid-number-hint')).not.toBeInTheDocument();
  });
});
