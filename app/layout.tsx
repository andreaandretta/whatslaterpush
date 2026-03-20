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
  title: 'WhatsLater - Promemoria WhatsApp automatici',
  description: 'I tuoi clienti non dimenticano più l\'appuntamento. Promemoria automatici da WhatsApp, dal tuo numero.',
  keywords: ['WhatsApp', 'promemoria', 'appuntamenti', 'automatici', 'professionisti'],
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
