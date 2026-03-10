'use client';
import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { Calendar } from 'lucide-react';

if (typeof window !== 'undefined') { gsap.registerPlugin(ScrollTrigger); }

export default function Navbar() {
  const navRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const ctx = gsap.context(() => {
      ScrollTrigger.create({
        start: 'top -50',
        end: 99999,
        toggleClass: { className: 'nav-scrolled', targets: navRef.current }
      });
    });
    return () => ctx.revert();
  }, []);

  return (
    <nav ref={navRef} className="fixed top-4 left-1/2 -translate-x-1/2 z-50 w-[90%] max-w-5xl rounded-full px-6 py-3 transition-all duration-300 flex items-center justify-between text-white [&.nav-scrolled]:bg-white/70 [&.nav-scrolled]:backdrop-blur-md [&.nav-scrolled]:text-text-primary [&.nav-scrolled]:shadow-sm [&.nav-scrolled]:border [&.nav-scrolled]:border-gray-200">
      <div className="flex items-center gap-2 font-bold text-xl tracking-tight">
        <Calendar className="w-6 h-6 text-primary" />
        <span>WhatsLater</span>
      </div>
      <div className="hidden md:flex items-center gap-8 text-sm font-medium">
        <a href="#come-funziona" className="hover:text-primary transition-colors">Come Funziona</a>
        <a href="#prezzi" className="hover:text-primary transition-colors">Prezzi</a>
        <a href="#faq" className="hover:text-primary transition-colors">FAQ</a>
      </div>
      <a href="#connetti" className="bg-primary text-white px-5 py-2 rounded-full text-sm font-semibold hover:scale-105 transition-transform shadow-[0_4px_14px_0_rgba(37,211,102,0.39)]">
        Connetti Ora
      </a>
    </nav>
  );
}
