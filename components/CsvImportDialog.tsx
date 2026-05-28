'use client';

import React, { useState } from 'react';
import { Upload, X, Check, AlertCircle } from 'lucide-react';
import { parseCsv, normalizeItalianPhoneForCsv } from '../app/lib/csv-parser';

interface Props {
  open: boolean;
  onClose: () => void;
  onImported: (summary: { imported: number; skipped: number; errors: number }) => void;
}

interface ParsedRow {
  name: string;
  rawPhone: string;
  normalizedPhone: string | null;
  rowIndex: number;
}

interface ParseSummary {
  rows: ParsedRow[];
  nameHeader: string | null;
  phoneHeader: string | null;
  validCount: number;
  invalidCount: number;
}

const MAX_ROWS = 1000;
const MIN_VALID_RATIO = 0.5;

function detectColumns(headers: string[]): { nameIdx: number; phoneIdx: number } {
  const nameTokens = ['name', 'nome', 'cliente', 'contatto'];
  const phoneTokens = ['phone', 'numero', 'telefono', 'cellulare', 'mobile', 'number'];
  let nameIdx = -1;
  let phoneIdx = -1;
  headers.forEach((h, i) => {
    const lh = h.toLowerCase();
    if (nameIdx < 0 && nameTokens.some(t => lh.includes(t))) nameIdx = i;
    if (phoneIdx < 0 && phoneTokens.some(t => lh.includes(t))) phoneIdx = i;
  });
  // Defaults: assume column 0=name, 1=phone (most common shape).
  if (nameIdx < 0 && headers.length > 0) nameIdx = 0;
  if (phoneIdx < 0 && headers.length > 1) phoneIdx = 1;
  return { nameIdx, phoneIdx };
}

function summarizeCsv(text: string): { ok: true; summary: ParseSummary } | { ok: false; error: string } {
  const { headers, rows } = parseCsv(text);
  if (rows.length === 0) return { ok: false, error: 'CSV vuoto o non leggibile.' };
  if (rows.length > MAX_ROWS) return { ok: false, error: `Massimo ${MAX_ROWS} righe (${rows.length} trovate).` };

  const { nameIdx, phoneIdx } = detectColumns(headers);
  if (phoneIdx < 0) return { ok: false, error: 'Nessuna colonna numero riconosciuta.' };

  const parsed: ParsedRow[] = rows.map((cols, i) => {
    const name = nameIdx >= 0 ? (cols[nameIdx] || '').trim() : '';
    const rawPhone = (cols[phoneIdx] || '').trim();
    const normalizedPhone = normalizeItalianPhoneForCsv(rawPhone);
    return { name, rawPhone, normalizedPhone, rowIndex: i };
  });

  const validCount = parsed.filter(p => p.normalizedPhone !== null).length;
  if (validCount / parsed.length < MIN_VALID_RATIO) {
    return {
      ok: false,
      error: `Solo ${validCount}/${parsed.length} righe hanno un numero valido. Controlla che la colonna telefono sia corretta.`,
    };
  }

  return {
    ok: true,
    summary: {
      rows: parsed,
      nameHeader: nameIdx >= 0 ? headers[nameIdx] : null,
      phoneHeader: headers[phoneIdx] || null,
      validCount,
      invalidCount: parsed.length - validCount,
    },
  };
}

export function CsvImportDialog({ open, onClose, onImported }: Props) {
  const [phase, setPhase] = useState<'pick' | 'preview' | 'importing' | 'done' | 'error'>('pick');
  const [summary, setSummary] = useState<ParseSummary | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [result, setResult] = useState<{ imported: number; skipped: number; errors: number } | null>(null);

  if (!open) return null;

  async function onFile(file: File) {
    setErrorMsg(null);
    const text = await file.text();
    const r = summarizeCsv(text);
    if (!r.ok) {
      setErrorMsg(r.error);
      setPhase('error');
      return;
    }
    setSummary(r.summary);
    setPhase('preview');
  }

  async function submit() {
    if (!summary) return;
    setPhase('importing');
    const rows = summary.rows
      .filter(r => r.normalizedPhone !== null)
      .map(r => ({ name: r.name, phone: r.normalizedPhone as string }));
    try {
      const res = await fetch('/api/contacts/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows }),
      });
      const body = await res.json();
      if (!res.ok) {
        setErrorMsg(body.error || 'Errore importazione');
        setPhase('error');
        return;
      }
      const r = {
        imported: body.imported || 0,
        skipped: body.skipped_duplicates || 0,
        errors: Array.isArray(body.errors) ? body.errors.length : 0,
      };
      setResult(r);
      setPhase('done');
      onImported(r);
    } catch (e) {
      setErrorMsg((e as Error)?.message || 'Errore di rete');
      setPhase('error');
    }
  }

  return (
    <div className="fixed inset-0 z-dialog flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <button type="button" aria-label="Chiudi" tabIndex={-1} className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative bg-[#1F2C33] rounded-2xl w-full max-w-md p-5 text-white">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Importa contatti da CSV</h2>
          <button type="button" onClick={onClose} aria-label="Chiudi" className="p-1 rounded-full hover:bg-white/10">
            <X className="w-5 h-5" />
          </button>
        </div>

        {phase === 'pick' && (
          <div className="text-center py-6">
            <label className="inline-flex items-center gap-2 px-4 py-2.5 bg-primary text-white rounded-xl cursor-pointer hover:bg-primary/90">
              <Upload className="w-4 h-4" />
              Scegli file CSV
              <input
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onFile(f);
                }}
              />
            </label>
            <p className="text-xs text-gray-400 mt-3">Max 1000 righe. Colonne: nome, telefono.</p>
          </div>
        )}

        {phase === 'preview' && summary && (
          <div>
            <p className="text-sm text-gray-300 mb-2">
              Colonne rilevate: <span className="text-white">{summary.nameHeader || '(nessuna)'}</span> · <span className="text-white">{summary.phoneHeader}</span>
            </p>
            <p className="text-sm text-gray-400 mb-3">
              {summary.validCount} righe valide
              {summary.invalidCount > 0 ? `, ${summary.invalidCount} scartate` : ''}.
            </p>
            <div className="bg-[#0B141A] rounded-lg overflow-hidden border border-[#2A3942] mb-4">
              <table className="w-full text-xs">
                <thead className="bg-[#202C33] text-gray-400">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium">Nome</th>
                    <th className="text-left px-3 py-2 font-medium">Numero (normalizzato)</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.rows.slice(0, 5).map((r) => (
                    <tr key={r.rowIndex} className="border-t border-[#2A3942]">
                      <td className="px-3 py-1.5">{r.name || <span className="text-gray-500">—</span>}</td>
                      <td className="px-3 py-1.5">
                        {r.normalizedPhone ? (
                          <span className="text-green-400">+{r.normalizedPhone}</span>
                        ) : (
                          <span className="text-red-400">{r.rawPhone || '—'}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => { setSummary(null); setPhase('pick'); }}
                className="flex-1 py-2 rounded-xl text-gray-300 hover:bg-white/5"
              >
                Annulla
              </button>
              <button
                type="button"
                onClick={submit}
                className="flex-1 py-2 rounded-xl bg-primary text-white font-medium hover:bg-primary/90"
              >
                Importa {summary.validCount}
              </button>
            </div>
          </div>
        )}

        {phase === 'importing' && (
          <div className="text-center py-6 text-gray-400">Importazione in corso…</div>
        )}

        {phase === 'done' && result && (
          <div className="text-center py-4">
            <Check className="w-10 h-10 text-green-400 mx-auto mb-2" />
            <p className="text-base text-white mb-1">{result.imported} contatti importati</p>
            {result.skipped > 0 && (
              <p className="text-xs text-gray-400">{result.skipped} duplicati saltati (già presenti)</p>
            )}
            {result.errors > 0 && (
              <p className="text-xs text-amber-400 mt-1">{result.errors} righe scartate</p>
            )}
            <button
              type="button"
              onClick={onClose}
              className="mt-4 px-4 py-2 rounded-xl bg-primary text-white font-medium hover:bg-primary/90"
            >
              Chiudi
            </button>
          </div>
        )}

        {phase === 'error' && (
          <div className="text-center py-4">
            <AlertCircle className="w-10 h-10 text-red-400 mx-auto mb-2" />
            <p className="text-sm text-red-300">{errorMsg}</p>
            <button
              type="button"
              onClick={() => { setErrorMsg(null); setSummary(null); setPhase('pick'); }}
              className="mt-4 px-4 py-2 rounded-xl bg-[#2A3942] text-white hover:bg-[#374851]"
            >
              Riprova
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
