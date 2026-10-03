import type { Viewport } from 'next';

// La dashboard è scura, il resto del sito (landing, /connect) è chiaro: il
// colore della barra del browser e il fondo della pagina vanno scelti qui.
// Prima su iPhone c'era una fascia bianca sotto l'orologio e sotto la barra di
// Safari, e l'app sembrava incollata su un foglio (rapporto 360, T10).
// Il fondo di html/body lo mette globals.css con `html:has(.app-dark)`.
export const viewport: Viewport = {
  themeColor: '#111B21',
};

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <div className="app-dark">{children}</div>;
}
