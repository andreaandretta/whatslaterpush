import Link from 'next/link';

export const metadata = {
  title: 'Dashboard Redesign Mockups · WhatsLater',
  robots: { index: false, follow: false },
};

export default function MockupIndexPage() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="max-w-md w-full space-y-4">
        <h1 className="text-2xl font-bold mb-6 text-center text-text-primary">
          Dashboard Redesign Mockups
        </h1>
        <Link
          href="/mockup/v1"
          className="block bg-white border border-gray-200 rounded-xl p-4 hover:shadow-md transition-shadow"
        >
          <h3 className="font-bold text-text-primary">V1 — Status Strip + CTA Card</h3>
          <p className="text-sm text-text-secondary mt-1">
            Minimo cambio. Status compresso in 1 riga, CTA card separato.
          </p>
        </Link>
        <Link
          href="/mockup/v2"
          className="block bg-white border border-gray-200 rounded-xl p-4 hover:shadow-md transition-shadow"
        >
          <h3 className="font-bold text-text-primary">V2 — Status Card con CTA inline</h3>
          <p className="text-sm text-text-secondary mt-1">
            Densità media. CTA dentro la card status (riempie spazio post-hotfix).
          </p>
        </Link>
        <Link
          href="/mockup/v3"
          className="block bg-white border border-gray-200 rounded-xl p-4 hover:shadow-md transition-shadow"
        >
          <h3 className="font-bold text-text-primary">V3 — Hero CTA</h3>
          <p className="text-sm text-text-secondary mt-1">
            Redesign vero. Hero gigante, status minimale, lista messaggi snella.
          </p>
        </Link>
        <Link
          href="/mockup/v4"
          className="block bg-white border border-gray-200 rounded-xl p-4 hover:shadow-md transition-shadow"
        >
          <h3 className="font-bold text-text-primary">V4 — FAB + Lista protagonista</h3>
          <p className="text-sm text-text-secondary mt-1">
            Pattern Bud round 6. Status compresso in 1 riga, lista messaggi al centro,
            FAB bottom-right per primary action.
          </p>
        </Link>
        <Link
          href="/mockup/v4?empty=true"
          className="block bg-white border border-gray-200 rounded-xl p-4 hover:shadow-md transition-shadow"
        >
          <h3 className="font-bold text-text-primary">V4 — Empty state</h3>
          <p className="text-sm text-text-secondary mt-1">
            Cosa vede l&apos;utente al primo accesso (0 messaggi schedulati).
          </p>
        </Link>
      </div>
    </div>
  );
}
