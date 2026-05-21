import React, { useState, useEffect } from 'react';

interface ContactAvatarProps {
  name?: string;
  number: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  photoSrc?: string;
}

const PALETTE = [
  'bg-emerald-600',
  'bg-sky-600',
  'bg-amber-600',
  'bg-rose-600',
  'bg-violet-600',
  'bg-teal-600',
  'bg-indigo-600',
  'bg-orange-600',
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
  return digits.slice(-3);
}

function hashNumber(number: string): number {
  let h = 0;
  for (let i = 0; i < number.length; i++) h = (h * 31 + number.charCodeAt(i)) >>> 0;
  return h;
}

export function ContactAvatar({ name, number, size = 'md', className = '', photoSrc }: ContactAvatarProps) {
  const initials = computeInitials(name, number);
  const color = PALETTE[hashNumber(number) % PALETTE.length];
  const sizeClass = SIZES[size];

  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  // Reset state when src changes so a previous failure doesn't stick when the
  // parent eventually decides to load the photo for this contact.
  useEffect(() => {
    setLoaded(false);
    setFailed(false);
  }, [photoSrc]);

  const showImage = !!photoSrc && !failed;

  return (
    <div
      className={`${color} ${sizeClass} rounded-full flex items-center justify-center text-white font-semibold shrink-0 relative overflow-hidden ${className}`}
      aria-hidden="true"
    >
      <span className={loaded && showImage ? 'opacity-0' : 'opacity-100'}>{initials}</span>
      {showImage && (
        <img
          src={photoSrc}
          alt=""
          loading="lazy"
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-200 ${loaded ? 'opacity-100' : 'opacity-0'}`}
        />
      )}
    </div>
  );
}
