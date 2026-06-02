import type { Metadata, Viewport } from 'next'
import { Inter, Space_Grotesk } from 'next/font/google'
import './globals.css'
import ServiceWorkerRegistrar from './components/ServiceWorkerRegistrar'

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
})

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-space-grotesk',
})

export const metadata: Metadata = {
  title: 'WhatsLater - Programma messaggi WhatsApp dal tuo numero',
  description: 'Programma messaggi WhatsApp dal tuo numero personale. Per chi coordina squadre, fornitori e clienti ogni giorno.',
  keywords: ['WhatsApp', 'programmare messaggi', 'schedulare WhatsApp', 'allenatori', 'site manager', 'parroci', 'scout', 'istruttori sportivi', 'scuola guida', 'facility manager', 'coordinare squadra'],
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'WhatsLater',
  },
  icons: {
    icon: '/icons/favicon-32.png',
    apple: '/icons/icon-180.png',
  },
  openGraph: {
    title: 'WhatsLater - Programma messaggi WhatsApp dal tuo numero',
    description: 'Programma messaggi WhatsApp dal tuo numero personale. Per chi coordina squadre, fornitori e clienti ogni giorno.',
    locale: 'it_IT',
    type: 'website',
  },
}

export const viewport: Viewport = {
  themeColor: '#075E54',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="it" className={`${inter.variable} ${spaceGrotesk.variable}`}>
      <body className="font-sans antialiased bg-white text-[#111B21] selection:bg-[#25D366]/20 selection:text-[#075E54]">
        <script
          dangerouslySetInnerHTML={{
            __html:
              "window.__wlBip=null;window.addEventListener('beforeinstallprompt',function(e){e.preventDefault();window.__wlBip=e;});window.addEventListener('appinstalled',function(){window.__wlBip=null;});",
          }}
        />
        <ServiceWorkerRegistrar />
        {children}
      </body>
    </html>
  )
}
