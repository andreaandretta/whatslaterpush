import { pickUploadRoute, shouldCompressImage, fitWithin, uploadErrorMessage, VERCEL_BODY_LIMIT } from '../app/lib/upload-limits';

describe('upload-limits', () => {
  test('files above the Vercel body limit go through the signed URL, smaller ones through multipart', () => {
    expect(pickUploadRoute(200 * 1024)).toBe('multipart');
    expect(pickUploadRoute(VERCEL_BODY_LIMIT)).toBe('multipart');
    expect(pickUploadRoute(VERCEL_BODY_LIMIT + 1)).toBe('signed');
    expect(pickUploadRoute(15 * 1024 * 1024)).toBe('signed');
  });

  test('only big JPEG/PNG/WebP photos get compressed; GIFs, videos and small images never', () => {
    expect(shouldCompressImage('image/jpeg', 3 * 1024 * 1024)).toBe(true);
    expect(shouldCompressImage('image/png', 2 * 1024 * 1024)).toBe(true);
    expect(shouldCompressImage('image/jpeg', 500 * 1024)).toBe(false);
    expect(shouldCompressImage('image/gif', 5 * 1024 * 1024)).toBe(false);
    expect(shouldCompressImage('video/mp4', 5 * 1024 * 1024)).toBe(false);
  });

  test('fitWithin keeps the aspect ratio and never upscales', () => {
    expect(fitWithin(4000, 3000)).toEqual({ width: 1600, height: 1200 });
    expect(fitWithin(3000, 4000)).toEqual({ width: 1200, height: 1600 });
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
  });

  test('a platform 413 with a non-JSON body gets a human message', () => {
    expect(uploadErrorMessage(413, null)).toMatch(/troppo grande/i);
    expect(uploadErrorMessage(400, { error: 'file_too_large', limit_mb: 16 })).toBe('Max 16MB.');
    expect(uploadErrorMessage(400, { error: 'unsupported_mime' })).toMatch(/non supportato/i);
    expect(uploadErrorMessage(500, { error: 'boom' })).toBe('boom');
    expect(uploadErrorMessage(500, 'Internal Server Error')).toBe('Errore upload');
  });
});
