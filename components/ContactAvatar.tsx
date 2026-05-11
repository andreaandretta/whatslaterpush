import React from 'react';

interface ContactAvatarProps {
  name?: string;
  number: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const PALETTE = [
  'bg-emerald-500',
  'bg-sky-500',
  'bg-amber-500',
  'bg-rose-500',
  'bg-violet-500',
  'bg-teal-500',
  'bg-indigo-500',
  'bg-orange-500',
];

const SIZES = {
  sm: 'w-8 h-8 text-xs',
  md: 'w-10 h-10 text-sm',
  lg: 'w-14 h-14 text-base',
};

function computeInitials(name: string | undefined, number: string): string {
  const n = (name || '').trim();
  if (n) {
    const words = n.split(/\s+/).filter(Boolean);
    if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
    return words[0][0].toUpperCase();
  }
  const digits = number.replace(/\D/g, '');
  return digits.slice(-2);
}

function hashNumber(number: string): number {
  let h = 0;
  for (let i = 0; i < number.length; i++) h = (h * 31 + number.charCodeAt(i)) >>> 0;
  return h;
}

export function ContactAvatar({ name, number, size = 'md', className = '' }: ContactAvatarProps) {
  const initials = computeInitials(name, number);
  const color = PALETTE[hashNumber(number) % PALETTE.length];
  const sizeClass = SIZES[size];

  return (
    <div
      className={`${color} ${sizeClass} rounded-full flex items-center justify-center text-white font-semibold shrink-0 ${className}`}
      aria-hidden="true"
    >
      {initials}
    </div>
  );
}
