/* eslint-disable @next/next/no-img-element */
// Brand logo. Uses the PWA icon shipped in public/icons/ so the navbar
// matches the app icon shown on the install banner + home screen. Plain
// <img> rather than next/image because next.config.js sets images.unoptimized
// — the optimizer is off, so next/image only adds bundle weight without
// benefit. The SW precaches /icons/icon-192.png so this works offline too.

interface Props {
  size?: number;
  className?: string;
}

export default function Logo({ size = 32, className = '' }: Props) {
  return (
    <img
      src="/icons/icon-192.png"
      alt="WhatsLater"
      width={size}
      height={size}
      className={`rounded-[6px] shrink-0 ${className}`}
    />
  );
}
