// Brand mark — calendar + send badge as inline SVG. Scales crisp at any
// size and adapts to dark/light surfaces via the `variant` prop.
//
// A separate img-based logo lives in app/components/Logo.tsx and is used
// by the legal pages (privacy / terms / cookie) where the PWA icon is the
// canonical mark shown alongside the install banner. Don't merge the two
// without aligning those pages first.

interface Props {
  size?: number;
  withWordmark?: boolean;
  variant?: 'onDark' | 'onLight';
  className?: string;
}

export default function Logo({
  size = 20,
  withWordmark = false,
  variant = 'onDark',
  className = '',
}: Props) {
  const isDark = variant === 'onDark';
  const calBody = isDark ? '#FFFFFF' : '#075E54';
  const calLine = isDark ? '#075E54' : '#FFFFFF';
  // Ring sits between the badge and whatever is behind the logo, so it
  // tracks the background colour — dark navbar vs light connect page.
  const ringColor = isDark ? '#0B141A' : '#FFFFFF';
  const wordmarkColor = isDark ? 'text-white' : 'text-[#0B141A]';

  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
        className="shrink-0"
      >
        {/* Calendar body */}
        <rect x="1.2" y="4" width="16" height="17" rx="2.5" fill={calBody} />
        {/* Header divider, sotto i trattini */}
        <line x1="1.2" y1="9" x2="17.2" y2="9" stroke={calLine} strokeWidth="1.2" />
        {/* 2 trattini verticali in cima (ring posts) */}
        <rect x="5" y="2" width="1.8" height="4" rx="0.9" fill={calBody} />
        <rect x="11.6" y="2" width="1.8" height="4" rx="0.9" fill={calBody} />
        {/* Send badge — basso destra, sovrappone al corner */}
        <circle cx="18" cy="18" r="5.2" fill="#25D366" stroke={ringColor} strokeWidth="1.3" />
        {/* Paper plane bianco dentro al badge */}
        <path
          d="M15.5 18 L20.6 15.7 L19 20.5 L17.6 18.7 L15.5 18 Z"
          fill="white"
        />
      </svg>
      {withWordmark && (
        <span className={`font-heading font-bold text-lg tracking-tight ${wordmarkColor}`}>
          WhatsLater
        </span>
      )}
    </span>
  );
}
