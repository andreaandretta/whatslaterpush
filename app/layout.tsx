import type { Metadata, Viewport } from 'next'
import { Inter, Space_Grotesk } from 'next/font/google'
import './globals.css'
import ServiceWorkerRegistrar from './components/ServiceWorkerRegistrar'
import { siteUrl } from './lib/site'

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
})

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-space-grotesk',
})

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: 'WhatsLater - Promemoria WhatsApp dal numero che i tuoi clienti conoscono già',
  description: 'Promemoria WhatsApp automatici e ricorrenti, dal tuo numero (personale, WhatsApp Business o fisso). Gratis: 3 al giorno, per sempre.',
  keywords: ['promemoria WhatsApp', 'promemoria appuntamenti WhatsApp', 'programmare messaggi WhatsApp', 'messaggi ricorrenti WhatsApp', 'promemoria WhatsApp Business', 'promemoria clienti WhatsApp'],
  // './' = ogni pagina è canonical di sé stessa. Con '/' le pagine senza un proprio
  // alternates (/privacy, /terms, /cookie) dichiaravano come canonical la home.
  alternates: { canonical: './' },
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
    title: 'WhatsLater - Promemoria WhatsApp dal numero che i tuoi clienti conoscono già',
    description: 'Promemoria WhatsApp automatici e ricorrenti, dal tuo numero (personale, WhatsApp Business o fisso). Gratis: 3 al giorno, per sempre.',
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
