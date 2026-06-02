'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import Logo from '@/components/Logo';

export default function Navbar() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 50);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <nav className={`fixed top-0 left-0 right-0 z-40 bg-[#075E54] transition-shadow duration-300 ${
      scrolled ? 'shadow-md' : ''
    }`}>
      <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
        <Link href="/" aria-label="WhatsLater home">
          <Logo withWordmark variant="onDark" size={22} ringColor="#075E54" />
        </Link>

        <div className="hidden md:flex items-center gap-8">
          <a href="#come-funziona" className="text-sm text-white/70 hover:text-white transition-colors">Come Funziona</a>
          <a href="#prezzi" className="text-sm text-white/70 hover:text-white transition-colors">Prezzi</a>
          <a href="#faq" className="text-sm text-white/70 hover:text-white transition-colors">FAQ</a>
        </div>

        <Link
          href="/connect"
          className="bg-primary text-white px-5 h-12 flex items-center rounded-full text-sm font-semibold border border-white/20 hover:bg-primary-hover transition-colors"
        >
          <span className="hidden sm:inline">Programma i messaggi gratis</span>
          <span className="sm:hidden">Inizia gratis</span>
        </Link>
      </div>
    </nav>
  );
}
