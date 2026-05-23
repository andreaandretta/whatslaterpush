import type { Metadata } from 'next'
import { Inter, Space_Grotesk } from 'next/font/google'
import './globals.css'

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
  openGraph: {
    title: 'WhatsLater - Programma messaggi WhatsApp dal tuo numero',
    description: 'Programma messaggi WhatsApp dal tuo numero personale. Per chi coordina squadre, fornitori e clienti ogni giorno.',
    locale: 'it_IT',
    type: 'website',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="it" className={`${inter.variable} ${spaceGrotesk.variable}`}>
      <body className="font-sans antialiased bg-white text-[#111B21] selection:bg-[#25D366]/20 selection:text-[#075E54]">
        {children}
      </body>
    </html>
  )
}
