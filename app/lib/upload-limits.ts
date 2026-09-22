/**
 * Upload path selection and image compression policy (pure, testable).
 *
 * Vercel rejects any request body over ~4.5 MB at the platform edge with a
 * plain-text 413 "Request Entity Too Large" — it never reaches our route, so
 * the browser saw a non-JSON body and crashed with "Unexpected token 'R'".
 * Files above VERCEL_BODY_LIMIT must go straight to Supabase Storage through a
 * signed upload URL; smaller ones keep the existing multipart route.
 */
export const VERCEL_BODY_LIMIT = 4 * 1024 * 1024;   // 4 MB, safely under 4.5
export const MAX_UPLOAD_BYTES = 16 * 1024 * 1024;   // Evolution API ceiling
export const IMAGE_COMPRESS_ABOVE = 1024 * 1024;    // photos above 1 MB get resized
export const IMAGE_MAX_EDGE = 1600;                 // px, longest side after resize
export const IMAGE_JPEG_QUALITY = 0.82;

export type UploadRoute = 'multipart' | 'signed';

export function pickUploadRoute(bytes: number): UploadRoute {
  return bytes > VERCEL_BODY_LIMIT ? 'signed' : 'multipart';
}

/** Only JPEG/PNG/WebP photos above the threshold are worth re-encoding. GIFs would lose animation. */
export function shouldCompressImage(mime: string, bytes: number): boolean {
  return /^image\/(jpeg|png|webp)$/.test(mime) && bytes > IMAGE_COMPRESS_ABOVE;
}

/** Target size that keeps the aspect ratio with the longest edge at IMAGE_MAX_EDGE. */
export function fitWithin(width: number, height: number, maxEdge = IMAGE_MAX_EDGE): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return { width, height };
  const k = maxEdge / longest;
  return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) };
}

/** Human message for an upload failure, including the platform 413 that carries no JSON. */
export function uploadErrorMessage(status: number, body: any, maxMb = 16): string {
  if (status === 413) return 'File troppo grande per il caricamento. Riprova con un file più piccolo.';
  if (body?.error === 'file_too_large') return `Max ${body.limit_mb || maxMb}MB.`;
  if (body?.error === 'unsupported_mime') return 'Tipo di file non supportato.';
  if (typeof body?.error === 'string' && body.error) return body.error;
  return 'Errore upload';
}
