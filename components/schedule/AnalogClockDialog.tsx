'use client';

import React, { useState, useEffect } from 'react';

interface AnalogClockDialogProps {
  open: boolean;
  onClose: () => void;
  value: string; // "HH:MM"
  onConfirm: (s: string) => void;
}

type Phase = 'hour' | 'minute';

const SVG_SIZE = 280;
const CENTER = SVG_SIZE / 2;
const OUTER_R = 110;
const INNER_R = 72;

function parseTime(v: string): { h: number; m: number } {
  const [h, m] = v.split(':').map(Number);
  return { h: isNaN(h) ? 0 : h, m: isNaN(m) ? 0 : m };
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function positionForIndex(index: number, total: number, radius: number): { x: number; y: number } {
  const angleDeg = (index * (360 / total)) - 90;
  const angleRad = (angleDeg * Math.PI) / 180;
  return {
    x: CENTER + radius * Math.cos(angleRad),
    y: CENTER + radius * Math.sin(angleRad),
  };
}

export function AnalogClockDialog({ open, onClose, value, onConfirm }: AnalogClockDialogProps) {
  const initial = parseTime(value);
  const [hour, setHour] = useState<number>(initial.h);
  const [minute, setMinute] = useState<number>(initial.m);
  const [phase, setPhase] = useState<Phase>('hour');

  useEffect(() => {
    if (open) {
      const t = parseTime(value);
      setHour(t.h);
      setMinute(t.m);
      setPhase('hour');
    }
  }, [open, value]);

  if (!open) return null;

  function pickHour(h: number) {
    setHour(h);
    setPhase('minute');
  }
  function pickMinute(m: number) {
    setMinute(m);
  }

  const hourNodes = phase === 'hour'
    ? [
        ...Array.from({ length: 12 }, (_, i) => {
          const p = positionForIndex(i, 12, OUTER_R);
          return { value: i, x: p.x, y: p.y };
        }),
        ...Array.from({ length: 12 }, (_, i) => {
          const p = positionForIndex(i, 12, INNER_R);
          return { value: i + 12, x: p.x, y: p.y };
        }),
      ]
    : [];

  const minuteNodes = phase === 'minute'
    ? Array.from({ length: 12 }, (_, i) => {
        const p = positionForIndex(i, 12, OUTER_R);
        return { value: i * 5, x: p.x, y: p.y };
      })
    : [];

  const handAngle = phase === 'hour'
    ? ((hour % 12) * 30) - 90
    : (minute / 5 * 30) - 90;
  const handLength = phase === 'hour' && hour >= 12 ? INNER_R : OUTER_R;
  const handEndX = CENTER + handLength * Math.cos((handAngle * Math.PI) / 180);
  const handEndY = CENTER + handLength * Math.sin((handAngle * Math.PI) / 180);

  return (
    <div
      className="fixed inset-0 z-dialog flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Seleziona orario"
    >
      <button
        type="button"
        aria-label="Chiudi"
        tabIndex={-1}
        className="absolute inset-0 bg-black/70"
        onClick={onClose}
      />
      <div className="relative w-full max-w-xs bg-[#1F2C33] rounded-3xl p-6 shadow-2xl">
        <div className="flex items-center justify-center gap-1 text-4xl font-semibold mb-6">
          <button
            type="button"
            data-testid="clock-hour"
            onClick={() => setPhase('hour')}
            className={`focus:outline-none focus:ring-2 focus:ring-primary/30 rounded ${phase === 'hour' ? 'text-primary' : 'text-gray-300'}`}
          >
            {pad(hour)}
          </button>
          <span className="text-gray-300">:</span>
          <button
            type="button"
            data-testid="clock-minute"
            onClick={() => setPhase('minute')}
            className={`focus:outline-none focus:ring-2 focus:ring-primary/30 rounded ${phase === 'minute' ? 'text-primary' : 'text-gray-300'}`}
          >
            {pad(minute)}
          </button>
        </div>

        <svg
          width={SVG_SIZE}
          height={SVG_SIZE}
          viewBox={`0 0 ${SVG_SIZE} ${SVG_SIZE}`}
          className="mx-auto"
          aria-hidden="true"
        >
          <circle cx={CENTER} cy={CENTER} r={OUTER_R + 24} fill="#2A3942" />
          <line
            x1={CENTER}
            y1={CENTER}
            x2={handEndX}
            y2={handEndY}
            stroke="#25D366"
            strokeWidth={2}
            style={{ transition: 'all 0.2s' }}
          />
          <circle cx={CENTER} cy={CENTER} r={4} fill="#25D366" />
          <circle cx={handEndX} cy={handEndY} r={18} fill="#25D366" opacity={0.25} />

          {phase === 'hour' && hourNodes.map((n) => {
            const isSelected = n.value === hour;
            return (
              <g
                key={`h-${n.value}`}
                data-testid={`clock-node-${n.value}`}
                onClick={() => pickHour(n.value)}
                style={{ cursor: 'pointer' }}
              >
                <circle cx={n.x} cy={n.y} r={16} fill="transparent" />
                <text
                  x={n.x}
                  y={n.y}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={n.value >= 12 ? 12 : 14}
                  fill="#fff"
                  fontWeight={isSelected ? 600 : 400}
                >
                  {n.value === 0 ? '00' : n.value}
                </text>
              </g>
            );
          })}
          {phase === 'minute' && minuteNodes.map((n) => {
            const isSelected = n.value === minute;
            return (
              <g
                key={`m-${n.value}`}
                data-testid={`clock-node-${n.value}`}
                onClick={() => pickMinute(n.value)}
                style={{ cursor: 'pointer' }}
              >
                <circle cx={n.x} cy={n.y} r={16} fill="transparent" />
                <text
                  x={n.x}
                  y={n.y}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={14}
                  fill="#fff"
                  fontWeight={isSelected ? 600 : 400}
                >
                  {pad(n.value)}
                </text>
              </g>
            );
          })}
        </svg>

        <div className="flex justify-end gap-2 mt-4">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-full text-primary text-sm font-medium hover:bg-white/5 focus:outline-none focus:ring-2 focus:ring-primary/30"
          >
            Annulla
          </button>
          <button
            type="button"
            onClick={() => { onConfirm(`${pad(hour)}:${pad(minute)}`); onClose(); }}
            className="px-4 py-2 rounded-full text-primary text-sm font-semibold hover:bg-white/5 focus:outline-none focus:ring-2 focus:ring-primary/30"
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
