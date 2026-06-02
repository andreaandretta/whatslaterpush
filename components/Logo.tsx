// Brand mark — inline SVG that mirrors the PWA app icon shipped in
// public/icons/. The badge ring (outer circle r=96) must take the colour
// of the surface behind the logo, otherwise the green badge bleeds into
// the green wordmark area. Pass `ringColor` per-callsite when the surface
// is anything other than the dashboard navbar (#111B21).
//
// A separate img-based logo lives in app/components/Logo.tsx and is used
// by the legal pages (privacy / terms / cookie) where the PWA icon PNG is
// the canonical mark shown alongside the install banner. Don't merge the
// two without aligning those pages first.

interface Props {
  size?: number;
  withWordmark?: boolean;
  variant?: 'onDark' | 'onLight';
  ringColor?: string;
  className?: string;
}

export default function Logo({
  size = 20,
  withWordmark = false,
  variant = 'onDark',
  ringColor = '#111B21',
  className = '',
}: Props) {
  const wordmarkColor = variant === 'onDark' ? 'text-white' : 'text-[#0B141A]';

  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 512 512"
        aria-hidden="true"
        className="shrink-0"
      >
        <rect x="196" y="128" width="24" height="52" rx="12" fill="#fff" />
        <rect x="292" y="128" width="24" height="52" rx="12" fill="#fff" />
        <rect x="132" y="156" width="248" height="224" rx="30" fill="#fff" />
        <line
          x1="150"
          y1="214"
          x2="362"
          y2="214"
          stroke="#cfd8dc"
          strokeWidth="8"
          strokeLinecap="round"
        />
        <g fill="#9aa7b0">
          <rect x="165" y="241" width="22" height="22" rx="6" />
          <rect x="221" y="241" width="22" height="22" rx="6" />
          <rect x="277" y="241" width="22" height="22" rx="6" />
          <rect x="165" y="295" width="22" height="22" rx="6" />
          <rect x="221" y="295" width="22" height="22" rx="6" />
        </g>
        <circle cx="356" cy="356" r="96" fill={ringColor} />
        <circle cx="356" cy="356" r="82" fill="#25D366" />
        <path d="M322 330 L396 356 L322 382 L336 356 Z" fill="#fff" />
      </svg>
      {withWordmark && (
        <span className={`font-heading font-bold text-lg tracking-tight ${wordmarkColor}`}>
          WhatsLater
        </span>
      )}
    </span>
  );
}
