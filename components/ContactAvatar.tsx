import React, { useState, useEffect } from 'react';
import { User, Users } from 'lucide-react';
import { computeInitials } from '../app/lib/contact-initials';
import { realPersonName } from '../app/lib/jid';

interface ContactAvatarProps {
  name?: string;
  number: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  photoSrc?: string;
  // 'group' = gruppo WhatsApp: fondo verde scuro, sempre l'icona con due
  // persone (mai iniziali né foto).
  variant?: 'person' | 'group';
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

// Icona a metà del cerchio. Prima `w-1/2` dentro uno <span> senza larghezza:
// l'icona del gruppo usciva minuscola (rapporto 360, T34).
const ICON_SIZES = {
  sm: 'w-4 h-4',
  md: 'w-5 h-5',
  lg: 'w-7 h-7',
};

function hashNumber(number: string): number {
  let h = 0;
  for (let i = 0; i < number.length; i++) h = (h * 31 + number.charCodeAt(i)) >>> 0;
  return h;
}

export function ContactAvatar({ name, number, size = 'md', className = '', photoSrc, variant = 'person' }: ContactAvatarProps) {
  const isGroup = variant === 'group';
  // Persona col suo numero come "nome": niente "3" nel cerchio, l'omino. Un
  // nome scelto ("118") tiene le iniziali. Un gruppo invece mostra SEMPRE
  // l'icona con due persone, come WhatsApp: con le iniziali ("PW") sembrava
  // una persona (rapporto 360, T34).
  const initials = isGroup ? '' : computeInitials(realPersonName(name, number));
  const sizeClass = SIZES[size];

  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  // Reset state when src changes so a previous failure doesn't stick when the
  // parent eventually decides to load the photo for this contact.
  useEffect(() => {
    setLoaded(false);
    setFailed(false);
  }, [photoSrc]);

  const showImage = !isGroup && !!photoSrc && !failed;

  // Neutral slate background for letter-only avatars so they don't compete
  // with real photo avatars. Photos still get the hashed palette as the
  // loading placeholder, covered by the <img> once it lands.
  const color = isGroup
    ? 'bg-[#1F5A45] text-[#BFF0D5]'
    : `${showImage ? PALETTE[hashNumber(number) % PALETTE.length] : 'bg-[#2A3942]'} text-white`;

  return (
    <div
      className={`${color} ${sizeClass} rounded-full flex items-center justify-center font-semibold shrink-0 relative overflow-hidden ${className}`}
      aria-hidden="true"
      data-variant={isGroup ? 'group' : undefined}
    >
      <span className={`flex items-center justify-center ${loaded && showImage ? 'opacity-0' : 'opacity-100'}`}>
        {initials || (isGroup
          ? <Users className={ICON_SIZES[size]} aria-hidden="true" />
          : <User className={ICON_SIZES[size]} aria-hidden="true" />)}
      </span>
      {showImage && (
        <img
          src={photoSrc}
          alt=""
          loading="lazy"
          decoding="async"
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-200 ${loaded ? 'opacity-100' : 'opacity-0'}`}
        />
      )}
    </div>
  );
}
