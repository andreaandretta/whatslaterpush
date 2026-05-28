'use client';

import React, { useState, useRef } from 'react';
import { Paperclip, Image as ImageIcon, Video, FileText, Mic, X, Loader2, AlertCircle } from 'lucide-react';

export interface MediaAttachment {
  media_url: string;          // Supabase Storage path returned by /api/messages/upload
  media_type: 'image' | 'video' | 'document' | 'audio';
  media_filename: string;
  bytes: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onAttached: (m: MediaAttachment) => void;
}

const MAX_MB = 16;

const KIND_TO_ACCEPT: Record<string, string> = {
  image: 'image/jpeg,image/png,image/gif,image/webp',
  video: 'video/mp4,video/webm,video/quicktime,video/3gpp',
  document: 'application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.openxmlformats-officedocument.presentationml.presentation,text/plain,text/csv',
  audio: 'audio/mpeg,audio/ogg,audio/wav,audio/webm,audio/aac,audio/x-m4a,audio/mp4',
};

const KIND_LABELS: Record<string, { icon: any; label: string }> = {
  image: { icon: ImageIcon, label: '📷 Foto' },
  video: { icon: Video, label: '🎥 Video' },
  document: { icon: FileText, label: '📄 Documento' },
  audio: { icon: Mic, label: '🎤 Audio' },
};

// Per-kind color treatment for the icon disc (picker grid) and chip.
// Class strings are inlined so Tailwind's JIT scanner picks them up.
const KIND_VISUAL: Record<MediaAttachment['media_type'], { tint: string; ink: string }> = {
  image:    { tint: 'bg-emerald-500/20', ink: 'text-emerald-400' },
  video:    { tint: 'bg-violet-500/20',  ink: 'text-violet-400'  },
  document: { tint: 'bg-sky-500/20',     ink: 'text-sky-400'     },
  audio:    { tint: 'bg-orange-500/20',  ink: 'text-orange-400'  },
};

export function MediaPicker({ open, onClose, onAttached }: Props) {
  const [kind, setKind] = useState<'image' | 'video' | 'document' | 'audio' | null>(null);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  if (!open) return null;

  function pick(k: 'image' | 'video' | 'document' | 'audio') {
    setKind(k);
    setErr(null);
    setTimeout(() => fileRef.current?.click(), 0);
  }

  async function onFile(file: File) {
    setErr(null);
    if (file.size > MAX_MB * 1024 * 1024) {
      setErr(`File troppo grande (max ${MAX_MB}MB).`);
      return;
    }
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/messages/upload', {
        method: 'POST',
        body: formData,
      });
      const body = await res.json();
      if (!res.ok) {
        setErr(body.error === 'file_too_large' ? `Max ${body.limit_mb || MAX_MB}MB.` :
                body.error === 'unsupported_mime' ? 'Tipo di file non supportato.' :
                body.error || 'Errore upload');
        setUploading(false);
        return;
      }
      onAttached({
        media_url: body.media_url,
        media_type: body.media_type,
        media_filename: body.media_filename,
        bytes: body.bytes,
      });
      setUploading(false);
      onClose();
    } catch (e) {
      setErr((e as Error)?.message || 'Errore di rete');
      setUploading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center"
      role="dialog"
      aria-modal="true"
      aria-label="Allega media"
    >
      <button type="button" aria-label="Chiudi" tabIndex={-1} className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full sm:max-w-sm bg-[#1F2C33] rounded-t-3xl pb-6 pt-4 px-3 animate-slide-up">
        <div aria-hidden="true" className="w-12 h-1 bg-gray-600 rounded-full mx-auto mb-4" />
        <div className="flex items-center justify-between mb-3 px-1">
          <h3 className="text-white font-semibold">Allega media</h3>
          <button type="button" onClick={onClose} aria-label="Chiudi" className="p-1 rounded-full hover:bg-white/10 text-white">
            <X className="w-4 h-4" />
          </button>
        </div>

        {uploading ? (
          <div className="text-center py-8">
            <Loader2 className="w-8 h-8 text-primary mx-auto animate-spin mb-2" />
            <p className="text-sm text-gray-400">Caricamento…</p>
          </div>
        ) : err ? (
          <div className="text-center py-6">
            <AlertCircle className="w-8 h-8 text-red-400 mx-auto mb-2" />
            <p className="text-sm text-red-300 mb-3">{err}</p>
            <button
              type="button"
              onClick={() => { setErr(null); setKind(null); }}
              className="text-sm text-gray-300 underline"
            >
              Riprova
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {(['image', 'video', 'document', 'audio'] as const).map((k) => {
              const Icon = KIND_LABELS[k].icon;
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => pick(k)}
                  className="flex flex-col items-center justify-center gap-2 py-4 rounded-xl bg-[#2A3942] hover:bg-[#374851] text-white"
                >
                  <div className={`w-12 h-12 rounded-full flex items-center justify-center ${KIND_VISUAL[k].tint}`}>
                    <Icon className={`w-6 h-6 ${KIND_VISUAL[k].ink}`} />
                  </div>
                  <span className="text-sm font-medium">{KIND_LABELS[k].label}</span>
                </button>
              );
            })}
          </div>
        )}

        <input
          ref={fileRef}
          type="file"
          accept={kind ? KIND_TO_ACCEPT[kind] : '*'}
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onFile(f);
          }}
        />

        <p className="text-xs text-gray-500 text-center mt-3">Max {MAX_MB}MB. Privato, accessibile solo al destinatario.</p>
      </div>
    </div>
  );
}

// Small inline pill rendered in ScheduleModal once a media is attached.
export function MediaAttachmentChip({ media, onClear }: { media: MediaAttachment; onClear: () => void }) {
  const Icon = KIND_LABELS[media.media_type].icon;
  const sizeKb = Math.round(media.bytes / 1024);
  const sizeLabel = sizeKb < 1024 ? `${sizeKb} KB` : `${(sizeKb / 1024).toFixed(1)} MB`;
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 bg-[#1F2C34] rounded-xl mx-4">
      <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${KIND_VISUAL[media.media_type].tint}`}>
        <Icon className={`w-4 h-4 ${KIND_VISUAL[media.media_type].ink}`} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm text-white truncate font-medium">{media.media_filename}</div>
        <div className="text-xs text-gray-400">{KIND_LABELS[media.media_type].label} · {sizeLabel}</div>
      </div>
      <button
        type="button"
        onClick={onClear}
        aria-label="Rimuovi media"
        className="p-1.5 rounded-full hover:bg-white/10 text-gray-400"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
