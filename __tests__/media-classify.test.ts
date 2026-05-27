import { classifyMediaType } from '../app/api/messages/upload/route';

describe('classifyMediaType', () => {
  test('classifies common image types', () => {
    expect(classifyMediaType('image/jpeg')).toBe('image');
    expect(classifyMediaType('image/png')).toBe('image');
    expect(classifyMediaType('image/gif')).toBe('image');
    expect(classifyMediaType('image/webp')).toBe('image');
  });

  test('classifies common video types', () => {
    expect(classifyMediaType('video/mp4')).toBe('video');
    expect(classifyMediaType('video/webm')).toBe('video');
    expect(classifyMediaType('video/quicktime')).toBe('video');
  });

  test('classifies common audio types', () => {
    expect(classifyMediaType('audio/mpeg')).toBe('audio');
    expect(classifyMediaType('audio/ogg')).toBe('audio');
    expect(classifyMediaType('audio/x-m4a')).toBe('audio');
  });

  test('classifies common document types', () => {
    expect(classifyMediaType('application/pdf')).toBe('document');
    expect(classifyMediaType('application/msword')).toBe('document');
    expect(classifyMediaType('text/csv')).toBe('document');
    expect(classifyMediaType('text/plain')).toBe('document');
  });

  test('rejects executable / script types (XSS surface)', () => {
    expect(classifyMediaType('application/x-msdownload')).toBeNull();
    expect(classifyMediaType('application/javascript')).toBeNull();
    expect(classifyMediaType('text/html')).toBeNull();
    expect(classifyMediaType('image/svg+xml')).toBeNull(); // SVG can contain script
  });

  test('rejects empty / garbage MIME', () => {
    expect(classifyMediaType('')).toBeNull();
    expect(classifyMediaType('garbage')).toBeNull();
    expect(classifyMediaType('image/')).toBeNull();
  });
});
