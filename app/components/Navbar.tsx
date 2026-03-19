'use client';
import { useState, useEffect } from 'react';
import { Calendar } from 'lucide-react';
import Link from 'next/link';

export default function Navbar() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 50);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <nav className={`fixed top-0 left-0 right-0 z-40 transition-all duration-300 ${
      scrolled
        ? 'bg-white/90 backdrop-blur-md shadow-sm'
        : 'bg-white/50 backdrop-blur-sm'
    }`}>
      <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2 text-accent font-heading font-bold text-lg">
          <Calendar className="w-5 h-5" />
          WhatsLater
        </Link>

        <div className="hidden md:flex items-center gap-8">
          <a href="#come-funziona" className="text-sm text-text-secondary hover:text-text-primary transition-colors">Come Funziona</a>
          <a href="#prezzi" className="text-sm text-text-secondary hover:text-text-primary transition-colors">Prezzi</a>
          <a href="#faq" className="text-sm text-text-secondary hover:text-text-primary transition-colors">FAQ</a>
        </div>

        <Link
          href="/dashboard"
          className="bg-primary text-white px-5 h-12 flex items-center rounded-full text-sm font-semibold hover:bg-primary/90 transition-colors"
        >
          <span className="hidden sm:inline">Programma i messaggi gratis</span>
          <span className="sm:hidden">Inizia gratis</span>
        </Link>
      </div>
    </nav>
  );
}
