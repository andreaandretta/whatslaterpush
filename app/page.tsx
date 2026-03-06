'use client';

import React, { useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { TextPlugin } from 'gsap/TextPlugin';
import { 
  Calendar, MessageCircle, CheckCircle2, ArrowRight, Clock, Play, 
  Smartphone, Link as LinkIcon, ChevronDown, Loader2, Paperclip, 
  User, Send, X, QrCode, Hash, Shield, Zap, RefreshCw, Check
} from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

if (typeof window !== 'undefined') {
  gsap.registerPlugin(ScrollTrigger, TextPlugin);
}

export default function HomePage() {
  return (
    <div className="min-h-screen bg-background text-text-primary font-sans selection:bg-primary/20 selection:text-accent overflow-hidden">
      <Navbar />
      <HeroSection />
      <FeaturesSection />
      <PhilosophySection />
      <HowItWorksSection />
      <section id="connetti">
      <ConnectionZone />
      </section>
      <PricingSection />
      <FAQSection />
      <Footer />
    </div>
  );
}

function Navbar() {
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

function HeroSection() {
  const containerRef = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    const ctx = gsap.context(() => {
      // Floating bubbles
      gsap.to('.bubble', {
        y: 'random(-100, 100)',
        x: 'random(-100, 100)',
        rotation: 'random(-45, 45)',
        duration: 'random(10, 20)',
        repeat: -1,
        yoyo: true,
        ease: 'sine.inOut',
        stagger: 0.5
      });

      // Text reveal
      gsap.from('.hero-text', {
        y: 50,
        opacity: 0,
        duration: 1,
        stagger: 0.2,
        ease: 'power3.out',
        delay: 0.2
      });

      // Phone mockup slide up
      gsap.from('.phone-mockup', {
        y: 100,
        opacity: 0,
        duration: 1.2,
        ease: 'back.out(1.2)',
        delay: 0.6
      });

      // Phone animation timeline
      const tl = gsap.timeline({ repeat: -1, repeatDelay: 2 });
      
      // 1. Unlock & open WhatsApp
      tl.to('.phone-screen-lock', { opacity: 0, duration: 0.5, delay: 1 })
        .to('.wa-icon', { scale: 0.9, duration: 0.1, yoyo: true, repeat: 1 })
        .to('.home-screen', { opacity: 0, duration: 0.3 })
        .to('.wa-chats', { opacity: 1, duration: 0.3 })
      // 2. Tap "Te Stesso"
        .to('.chat-self', { backgroundColor: 'rgba(0,0,0,0.05)', duration: 0.1, yoyo: true, repeat: 1 }, '+=0.5')
        .to('.wa-chats', { opacity: 0, duration: 0.3 })
        .to('.wa-inside-chat', { opacity: 1, duration: 0.3 })
      // 3. Tap attachment
        .to('.attach-icon', { scale: 0.8, duration: 0.1, yoyo: true, repeat: 1 }, '+=0.5')
        .to('.attach-menu', { y: 0, opacity: 1, duration: 0.3, ease: 'back.out(1.5)' })
      // 4. Tap Contact
        .to('.contact-btn', { scale: 0.9, duration: 0.1, yoyo: true, repeat: 1 }, '+=0.5')
        .to('.attach-menu', { y: 50, opacity: 0, duration: 0.2 })
      // 5. Contact card slides in
        .fromTo('.contact-card-preview', { y: 50, opacity: 0 }, { y: 0, opacity: 1, duration: 0.4, ease: 'spring' })
        .to('.send-contact-btn', { scale: 0.9, duration: 0.1, yoyo: true, repeat: 1 }, '+=0.5')
        .to('.contact-card-preview', { opacity: 0, duration: 0.2 })
      // 6. Contact card appears as sent
        .fromTo('.sent-contact', { scale: 0.8, opacity: 0, x: 20 }, { scale: 1, opacity: 1, x: 0, duration: 0.3, ease: 'back.out(1.5)' })
      // 7. Type message
        .to('.typing-indicator', { opacity: 1, duration: 0.2 }, '+=0.5')
        .to('.chat-input-text', { text: "Ricorda l'appuntamento di domani alle 10:00", duration: 1.5, ease: 'none' })
        .to('.typing-indicator', { opacity: 0, duration: 0.1 })
        .to('.send-msg-btn', { scale: 0.8, duration: 0.1, yoyo: true, repeat: 1 }, '+=0.2')
      // 8. Message sent & confirmation
        .to('.chat-input-text', { text: "", duration: 0.1 })
        .fromTo('.sent-msg', { scale: 0.8, opacity: 0, x: 20 }, { scale: 1, opacity: 1, x: 0, duration: 0.3, ease: 'back.out(1.5)' })
        .fromTo('.confirmation-badge', { y: 20, opacity: 0 }, { y: 0, opacity: 1, duration: 0.4, ease: 'back.out(1.5)' }, '+=0.5')
        .to({}, { duration: 3 }); // Hold at the end

    }, containerRef);
    return () => ctx.revert();
  }, []);

  return (
    <section ref={containerRef} className="relative min-h-[100dvh] flex flex-col items-center justify-center pt-20 overflow-hidden bg-gradient-to-b from-background via-[#e8f5e9] to-white">
      {/* Background Bubbles */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {[...Array(6)].map((_, i) => (
          <div key={i} className={cn("bubble absolute rounded-full bg-primary/10 blur-3xl", 
            i % 2 === 0 ? "w-64 h-64" : "w-96 h-96")}
            style={{
              left: `${Math.random() * 100}%`,
              top: `${Math.random() * 100}%`,
            }}
          />
        ))}
      </div>

      <div className="relative z-10 text-center px-4 max-w-4xl mx-auto mt-10">
        <h1 className="hero-text text-5xl md:text-7xl font-bold text-text-primary tracking-tight mb-2 font-sans">
          Scrivi Ora.
        </h1>
        <h2 className="hero-text text-6xl md:text-8xl font-serif italic text-primary mb-6">
          Invia Dopo.
        </h2>
        <p className="hero-text text-text-secondary font-mono text-sm md:text-base max-w-xl mx-auto leading-relaxed">
          Programma i messaggi WhatsApp semplicemente chattando a te stesso. Nessuna complicazione. A partire da €1.99/mese.
        </p>
      </div>

      {/* Phone Mockup */}
      <div className="phone-mockup relative mt-16 w-[300px] h-[600px] bg-black rounded-[3rem] border-[8px] border-black shadow-[0_20px_50px_rgba(0,0,0,0.2)] flex-shrink-0">
        {/* Side Buttons */}
        <div className="absolute -left-[10px] top-24 w-1 h-8 bg-gray-800 rounded-l-md"></div>
        <div className="absolute -left-[10px] top-36 w-1 h-12 bg-gray-800 rounded-l-md"></div>
        <div className="absolute -left-[10px] top-52 w-1 h-12 bg-gray-800 rounded-l-md"></div>
        <div className="absolute -right-[10px] top-36 w-1 h-16 bg-gray-800 rounded-r-md"></div>

        {/* Dynamic Island / Notch */}
        <div className="absolute top-2 left-1/2 -translate-x-1/2 w-24 h-6 bg-black rounded-full z-50"></div>
        
        {/* Screen Content */}
        <div className="relative w-full h-full bg-[#EFEAE2] overflow-hidden font-sans text-sm rounded-[2.5rem]">
          
          {/* Lock Screen */}
          <div className="phone-screen-lock absolute inset-0 bg-black/40 backdrop-blur-md z-40 flex flex-col items-center justify-center text-white">
            <Clock className="w-12 h-12 mb-2 opacity-80" />
            <div className="text-4xl font-light">09:41</div>
            <div className="text-sm mt-2 opacity-80">Scorri per sbloccare</div>
          </div>

          {/* Home Screen */}
          <div className="home-screen absolute inset-0 bg-gradient-to-b from-blue-400 to-blue-600 z-30 p-6 pt-16">
            <div className="grid grid-cols-4 gap-4">
              <div className="wa-icon w-12 h-12 bg-[#25D366] rounded-2xl flex items-center justify-center shadow-sm mx-auto">
                <MessageCircle className="w-7 h-7 text-white" fill="currentColor" />
              </div>
            </div>
          </div>

          {/* WhatsApp Chats List */}
          <div className="wa-chats absolute inset-0 bg-white z-20 opacity-0 flex flex-col">
            <div className="bg-[#075E54] text-white pt-12 pb-3 px-4 flex justify-between items-center">
              <span className="font-semibold text-lg">WhatsApp</span>
            </div>
            <div className="flex-1 overflow-hidden">
              <div className="chat-self flex items-center gap-3 p-3 border-b border-gray-100">
                <div className="w-12 h-12 bg-gray-200 rounded-full flex items-center justify-center">
                  <User className="w-6 h-6 text-gray-500" />
                </div>
                <div className="flex-1">
                  <div className="flex justify-between">
                    <span className="font-semibold">Te Stesso (Tu)</span>
                    <span className="text-xs text-gray-500">09:41</span>
                  </div>
                  <span className="text-sm text-gray-500">Invia un messaggio...</span>
                </div>
              </div>
              {/* Dummy chats */}
              {[1,2,3].map(i => (
                <div key={i} className="flex items-center gap-3 p-3 border-b border-gray-100 opacity-50">
                  <div className="w-12 h-12 bg-gray-200 rounded-full"></div>
                  <div className="flex-1">
                    <div className="h-4 bg-gray-200 rounded w-24 mb-2"></div>
                    <div className="h-3 bg-gray-100 rounded w-40"></div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Inside Chat */}
          <div className="wa-inside-chat absolute inset-0 bg-[#EFEAE2] z-10 opacity-0 flex flex-col">
            {/* Header */}
            <div className="bg-[#075E54] text-white pt-12 pb-2 px-2 flex items-center gap-2">
              <ArrowRight className="w-5 h-5 rotate-180" />
              <div className="w-8 h-8 bg-gray-300 rounded-full flex items-center justify-center">
                <User className="w-5 h-5 text-gray-600" />
              </div>
              <span className="font-semibold">Te Stesso (Tu)</span>
            </div>
            
            {/* Chat Area */}
            <div className="flex-1 p-3 flex flex-col justify-end gap-2 overflow-hidden relative">
              {/* Sent Contact */}
              <div className="sent-contact self-end bg-[#dcf8c6] p-2 rounded-lg rounded-tr-none shadow-sm max-w-[80%] opacity-0">
                <div className="flex items-center gap-3 border-b border-green-200 pb-2 mb-2">
                  <div className="w-10 h-10 bg-gray-300 rounded-full flex items-center justify-center">
                    <User className="w-6 h-6 text-gray-600" />
                  </div>
                  <span className="font-semibold">Andrea</span>
                </div>
                <div className="text-xs text-center text-gray-600">Messaggio a Andrea</div>
              </div>

              {/* Sent Message */}
              <div className="sent-msg self-end bg-[#dcf8c6] p-2 rounded-lg rounded-tr-none shadow-sm max-w-[80%] opacity-0">
                <span className="text-sm">Ricorda l'appuntamento di domani alle 10:00</span>
                <div className="text-[10px] text-gray-500 text-right mt-1">09:42</div>
              </div>

              {/* Confirmation Badge */}
              <div className="confirmation-badge self-center bg-white/90 backdrop-blur-sm px-3 py-1.5 rounded-full shadow-sm text-xs font-medium text-primary flex items-center gap-1.5 opacity-0 mt-2">
                <CheckCircle2 className="w-3.5 h-3.5" />
                Programmato per Dom 24 Feb, 10:00
              </div>
            </div>

            {/* Input Area */}
            <div className="bg-[#f0f0f0] p-2 flex items-end gap-2 pb-6">
              <div className="bg-white flex-1 rounded-full flex items-center px-3 py-2 min-h-[40px]">
                <span className="chat-input-text text-sm text-gray-800"></span>
                <span className="typing-indicator w-0.5 h-4 bg-primary ml-0.5 animate-pulse opacity-0"></span>
              </div>
              <div className="attach-icon w-10 h-10 rounded-full flex items-center justify-center text-gray-500">
                <Paperclip className="w-5 h-5" />
              </div>
              <div className="send-msg-btn w-10 h-10 bg-[#00a884] rounded-full flex items-center justify-center text-white shadow-sm">
                <Send className="w-4 h-4 ml-1" />
              </div>
            </div>

            {/* Attachment Menu Overlay */}
            <div className="attach-menu absolute bottom-20 left-4 right-4 bg-white rounded-2xl p-4 shadow-lg opacity-0 translate-y-10 flex flex-wrap justify-center gap-4">
              <div className="flex flex-col items-center gap-1">
                <div className="w-12 h-12 bg-blue-500 rounded-full flex items-center justify-center text-white"><User className="w-6 h-6" /></div>
                <span className="text-xs">Documento</span>
              </div>
              <div className="flex flex-col items-center gap-1">
                <div className="w-12 h-12 bg-pink-500 rounded-full flex items-center justify-center text-white"><User className="w-6 h-6" /></div>
                <span className="text-xs">Fotocamera</span>
              </div>
              <div className="contact-btn flex flex-col items-center gap-1">
                <div className="w-12 h-12 bg-blue-400 rounded-full flex items-center justify-center text-white"><User className="w-6 h-6" /></div>
                <span className="text-xs font-medium">Contatto</span>
              </div>
            </div>

            {/* Contact Selection Preview */}
            <div className="contact-card-preview absolute bottom-0 left-0 right-0 bg-white rounded-t-3xl p-4 shadow-[0_-10px_40px_rgba(0,0,0,0.1)] opacity-0 translate-y-full pb-8">
              <div className="text-center font-semibold mb-4">Invia contatto</div>
              <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl mb-4">
                <div className="w-12 h-12 bg-gray-300 rounded-full flex items-center justify-center"><User className="w-6 h-6 text-gray-600" /></div>
                <span className="font-medium text-lg">Andrea</span>
              </div>
              <div className="send-contact-btn w-12 h-12 bg-[#00a884] rounded-full flex items-center justify-center text-white shadow-md mx-auto">
                <Send className="w-5 h-5 ml-1" />
              </div>
            </div>

          </div>
        </div>
      </div>
    </section>
  );
}

function FeaturesSection() {
  const sectionRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const ctx = gsap.context(() => {
      // Card 1: Natural Language
      const tl1 = gsap.timeline({ repeat: -1, repeatDelay: 2 });
      tl1.to('.nl-input', { text: "Manda a Marco tra 2 ore", duration: 1.5, ease: 'none' })
         .to('.nl-dots', { opacity: 1, duration: 0.2 })
         .to('.nl-dots', { opacity: 0, duration: 0.2, delay: 1 })
         .fromTo('.nl-output', { y: 10, opacity: 0 }, { y: 0, opacity: 1, duration: 0.4 })
         .to({}, { duration: 2 })
         .to('.nl-input', { text: "", duration: 0.1 })
         .to('.nl-output', { opacity: 0, duration: 0.1 })
         .to('.nl-input', { text: "Domani mattina alle 8", duration: 1.5, ease: 'none' })
         .to('.nl-dots', { opacity: 1, duration: 0.2 })
         .to('.nl-dots', { opacity: 0, duration: 0.2, delay: 1 })
         .to('.nl-output-2', { y: 0, opacity: 1, duration: 0.4 })
         .to({}, { duration: 2 })
         .to('.nl-input', { text: "", duration: 0.1 })
         .to('.nl-output-2', { opacity: 0, duration: 0.1 });

      // Card 2: Attach Contact
      const tl2 = gsap.timeline({ repeat: -1, repeatDelay: 2 });
      tl2.fromTo('.ac-contact', { y: 20, opacity: 0 }, { y: 0, opacity: 1, duration: 0.5, ease: 'spring' })
         .to('.ac-caption', { text: "Buon compleanno! 🎂", duration: 1.5, ease: 'none', delay: 0.5 })
         .fromTo('.ac-badge', { scale: 0.8, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.4, ease: 'back.out(1.5)', delay: 0.5 })
         .to({}, { duration: 2 })
         .to(['.ac-contact', '.ac-caption', '.ac-badge'], { opacity: 0, duration: 0.3 });

      // Card 3: Smart Queue
      const tl3 = gsap.timeline({ repeat: -1, repeatDelay: 2 });
      tl3.to('.sq-timer', { text: "00:00", duration: 2, ease: 'none' })
         .to('.sq-status-1', { rotationX: 90, duration: 0.2 })
         .to('.sq-status-1-done', { rotationX: 0, duration: 0.2 })
         .to('.sq-row-1', { y: -50, opacity: 0, duration: 0.4, delay: 0.5 })
         .to('.sq-row-2', { y: -60, duration: 0.4 }, '<')
         .to('.sq-row-3', { y: -60, duration: 0.4 }, '<')
         .fromTo('.sq-row-new', { y: 20, opacity: 0 }, { y: -60, opacity: 1, duration: 0.5, ease: 'back.out(1.5)' })
         .to('.sq-cancel-input', { text: "Cancella Marco", duration: 1, ease: 'none', delay: 1 })
         .to('.sq-row-2', { x: 50, opacity: 0, backgroundColor: '#fee2e2', duration: 0.4 })
         .to({}, { duration: 2 })
         .to(['.sq-row-1', '.sq-row-2', '.sq-row-3', '.sq-row-new', '.sq-cancel-input'], { clearProps: 'all' })
         .to('.sq-status-1', { rotationX: 0, duration: 0 })
         .to('.sq-status-1-done', { rotationX: -90, duration: 0 });

    }, sectionRef);
    return () => ctx.revert();
  }, []);

  return (
    <section ref={sectionRef} className="py-32 px-6 bg-white">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-20">
          <h2 className="text-4xl md:text-5xl font-bold text-text-primary mb-4 tracking-tight">
            La Magia di Programmare e Dimenticare
          </h2>
          <p className="text-xl text-text-secondary font-serif italic">
            Tre superpoteri per chi tiene davvero alle persone.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {/* Card 1 */}
          <div className="bg-background rounded-3xl p-8 shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-gray-100 flex flex-col h-[400px]">
            <h3 className="text-xl font-bold mb-2 flex items-center gap-2"><Zap className="w-5 h-5 text-primary" /> Linguaggio Naturale</h3>
            <p className="text-sm text-text-secondary mb-8">Scrivi come parleresti. L'AI capisce date, ore e intenzioni.</p>
            <div className="flex-1 flex flex-col justify-center items-center relative">
              <div className="w-full bg-white rounded-2xl p-4 shadow-sm border border-gray-50 mb-4">
                <span className="nl-input text-sm font-medium text-gray-800"></span>
                <span className="w-0.5 h-4 bg-primary inline-block ml-1 animate-pulse"></span>
              </div>
              <div className="nl-dots opacity-0 flex gap-1 mb-4">
                <div className="w-2 h-2 bg-primary rounded-full animate-bounce"></div>
                <div className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                <div className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
              </div>
              <div className="nl-output absolute bottom-10 opacity-0 bg-primary/10 text-accent px-4 py-2 rounded-xl text-sm font-mono font-medium flex items-center gap-2">
                <Calendar className="w-4 h-4" /> Oggi, 14:30 → Marco Rossi
              </div>
              <div className="nl-output-2 absolute bottom-10 opacity-0 bg-primary/10 text-accent px-4 py-2 rounded-xl text-sm font-mono font-medium flex items-center gap-2">
                <Calendar className="w-4 h-4" /> Dom 24 Feb, 08:00 → Luca B.
              </div>
            </div>
          </div>

          {/* Card 2 */}
          <div className="bg-background rounded-3xl p-8 shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-gray-100 flex flex-col h-[400px]">
            <h3 className="text-xl font-bold mb-2 flex items-center gap-2"><Paperclip className="w-5 h-5 text-primary" /> Allega il Contatto</h3>
            <p className="text-sm text-text-secondary mb-8">Invia la rubrica a te stesso. Aggiungi il messaggio. Fatto.</p>
            <div className="flex-1 flex flex-col justify-center items-center relative w-full">
              <div className="w-full max-w-[240px] bg-[#EFEAE2] rounded-2xl p-4 shadow-inner relative overflow-hidden h-[200px] flex flex-col justify-end">
                <div className="ac-contact bg-white p-3 rounded-xl shadow-sm mb-2 flex items-center gap-3">
                  <div className="w-10 h-10 bg-gray-200 rounded-full flex items-center justify-center"><User className="w-5 h-5 text-gray-500" /></div>
                  <span className="font-semibold text-sm">Andrea</span>
                </div>
                <div className="bg-[#dcf8c6] p-2 rounded-xl rounded-tr-none self-end shadow-sm mb-2 min-h-[36px] min-w-[100px]">
                  <span className="ac-caption text-sm"></span>
                </div>
                <div className="ac-badge absolute top-4 left-1/2 -translate-x-1/2 bg-white/90 backdrop-blur-sm px-3 py-1 rounded-full shadow-sm text-[10px] font-medium text-primary flex items-center gap-1 whitespace-nowrap">
                  <CheckCircle2 className="w-3 h-3" /> Programmato → 15 Mar, 09:00
                </div>
              </div>
            </div>
          </div>

          {/* Card 3 */}
          <div className="bg-background rounded-3xl p-8 shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-gray-100 flex flex-col h-[400px]">
            <h3 className="text-xl font-bold mb-2 flex items-center gap-2"><RefreshCw className="w-5 h-5 text-primary" /> Coda Intelligente</h3>
            <p className="text-sm text-text-secondary mb-8">Gestisci tutto dalla chat. Annulla con un messaggio.</p>
            <div className="flex-1 flex flex-col relative w-full overflow-hidden">
              <div className="space-y-2 relative h-[150px]">
                <div className="sq-row-1 bg-white p-3 rounded-xl shadow-sm border border-gray-50 flex justify-between items-center relative z-30">
                  <div className="flex flex-col">
                    <span className="text-xs font-bold">Marco R.</span>
                    <span className="text-[10px] text-gray-500 truncate w-24">"Ciao, ci vediamo?"</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="sq-timer text-xs font-mono text-orange-500">00:03</span>
                    <div className="relative w-4 h-4">
                      <Clock className="sq-status-1 absolute inset-0 w-4 h-4 text-orange-500" />
                      <CheckCircle2 className="sq-status-1-done absolute inset-0 w-4 h-4 text-primary" style={{ transform: 'rotateX(-90deg)' }} />
                    </div>
                  </div>
                </div>
                <div className="sq-row-2 bg-white p-3 rounded-xl shadow-sm border border-gray-50 flex justify-between items-center relative z-20">
                  <div className="flex flex-col">
                    <span className="text-xs font-bold">Sara M.</span>
                    <span className="text-[10px] text-gray-500 truncate w-24">"Buon compleanno!"</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono text-gray-400">15 Mar</span>
                    <Clock className="w-4 h-4 text-gray-400" />
                  </div>
                </div>
                <div className="sq-row-3 bg-white p-3 rounded-xl shadow-sm border border-gray-50 flex justify-between items-center relative z-10 opacity-50">
                  <div className="flex flex-col">
                    <span className="text-xs font-bold">Luca B.</span>
                    <span className="text-[10px] text-gray-500 truncate w-24">"Reminder app..."</span>
                  </div>
                  <CheckCircle2 className="w-4 h-4 text-primary" />
                </div>
                <div className="sq-row-new absolute top-full left-0 right-0 bg-white p-3 rounded-xl shadow-sm border border-gray-50 flex justify-between items-center opacity-0">
                  <div className="flex flex-col">
                    <span className="text-xs font-bold">Anna</span>
                    <span className="text-[10px] text-gray-500 truncate w-24">"Riunione spostata"</span>
                  </div>
                  <Clock className="w-4 h-4 text-orange-500" />
                </div>
              </div>
              <div className="mt-auto bg-white rounded-full px-3 py-2 shadow-sm border border-gray-100 flex items-center">
                <span className="sq-cancel-input text-xs font-medium text-red-500"></span>
                <span className="w-0.5 h-3 bg-red-500 inline-block ml-1 animate-pulse"></span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function PhilosophySection() {
  const sectionRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.from('.phil-text-1', {
        scrollTrigger: {
          trigger: sectionRef.current,
          start: 'top 60%',
          end: 'center center',
          scrub: 1
        },
        x: -100,
        opacity: 0
      });
      gsap.from('.phil-text-2', {
        scrollTrigger: {
          trigger: sectionRef.current,
          start: 'top 50%',
          end: 'center center',
          scrub: 1
        },
        x: 100,
        opacity: 0
      });
    }, sectionRef);
    return () => ctx.revert();
  }, []);

  return (
    <section ref={sectionRef} className="py-40 px-6 bg-text-primary text-white overflow-hidden">
      <div className="max-w-5xl mx-auto flex flex-col gap-8">
        <h2 className="phil-text-1 text-5xl md:text-7xl font-bold font-sans text-left">
          Dimenticare costa caro.
        </h2>
        <h2 className="phil-text-2 text-5xl md:text-7xl font-serif italic text-primary text-right">
          Essere presenti non ha prezzo.
        </h2>
        <p className="mt-16 text-sm md:text-base font-mono text-[#F3F5F7]/70 max-w-2xl mx-auto text-center leading-relaxed">
          WhatsLater è il gesto di cura programmata. Nessun compleanno dimenticato. Nessun follow-up perso. Nessun buongiorno mancato perché erano le 2 di notte. Costa meno di un caffè al mese.
        </p>
      </div>
    </section>
  );
}

function HowItWorksSection() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ctx = gsap.context(() => {
      const cards = gsap.utils.toArray('.hiw-card');
      
      cards.forEach((card: any, i) => {
        if (i === cards.length - 1) return; // Skip last card
        
        ScrollTrigger.create({
          trigger: card,
          start: 'top 10%',
          endTrigger: cards[i + 1],
          end: 'top 20%',
          pin: true,
          pinSpacing: false,
          animation: gsap.to(card, {
            scale: 0.9,
            opacity: 0.5,
            filter: 'blur(10px)',
            ease: 'none'
          }),
          scrub: true
        });
      });
    }, containerRef);
    return () => ctx.revert();
  }, []);

  return (
    <section ref={containerRef} id="come-funziona" className="py-20 bg-background relative">
      <div className="max-w-4xl mx-auto px-6">
        <div className="text-center mb-20">
          <h2 className="text-4xl font-bold text-text-primary">Come Funziona</h2>
        </div>

        <div className="space-y-24">
          {/* Card 1 */}
          <div className="hiw-card bg-white rounded-[3rem] p-10 md:p-16 shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-gray-100 min-h-[60vh] flex flex-col justify-center relative z-10">
            <div className="grid md:grid-cols-2 gap-12 items-center">
              <div>
                <div className="w-12 h-12 bg-primary/10 rounded-2xl flex items-center justify-center mb-6">
                  <span className="text-primary font-bold text-xl">1</span>
                </div>
                <h3 className="text-3xl font-bold mb-4">Connetti WhatsApp</h3>
                <p className="text-text-secondary mb-8">Scansiona il QR Code o usa un codice di abbinamento. Sicuro, veloce e direttamente dal tuo telefono.</p>
                <ul className="space-y-4 text-sm font-medium">
                  <li className="flex items-center gap-3"><Smartphone className="w-5 h-5 text-primary" /> Apri WhatsApp</li>
                  <li className="flex items-center gap-3"><Shield className="w-5 h-5 text-primary" /> Dispositivi collegati</li>
                  <li className="flex items-center gap-3"><LinkIcon className="w-5 h-5 text-primary" /> Collega un dispositivo</li>
                </ul>
              </div>
              <div className="bg-background rounded-3xl p-8 flex items-center justify-center">
                <div className="w-48 h-48 bg-white rounded-2xl shadow-sm border-2 border-primary/20 flex items-center justify-center relative overflow-hidden">
                  <QrCode className="w-32 h-32 text-text-primary" />
                  <div className="absolute inset-0 bg-gradient-to-b from-transparent via-primary/20 to-transparent h-1/2 animate-[scan_2s_ease-in-out_infinite]"></div>
                </div>
              </div>
            </div>
          </div>

          {/* Card 2 */}
          <div className="hiw-card bg-white rounded-[3rem] p-10 md:p-16 shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-gray-100 min-h-[60vh] flex flex-col justify-center relative z-20">
            <div className="grid md:grid-cols-2 gap-12 items-center">
              <div className="order-2 md:order-1 bg-[#EFEAE2] rounded-3xl p-6 flex items-center justify-center h-[400px] overflow-hidden relative">
                <div className="w-[240px] h-[480px] bg-white rounded-[2rem] shadow-xl border-4 border-gray-800 flex flex-col translate-y-10 relative">
                  {/* Side Buttons */}
                  <div className="absolute -left-[6px] top-16 w-1 h-6 bg-gray-800 rounded-l-md"></div>
                  <div className="absolute -left-[6px] top-24 w-1 h-10 bg-gray-800 rounded-l-md"></div>
                  <div className="absolute -left-[6px] top-36 w-1 h-10 bg-gray-800 rounded-l-md"></div>
                  <div className="absolute -right-[6px] top-24 w-1 h-12 bg-gray-800 rounded-r-md"></div>
                  
                  <div className="w-full h-full overflow-hidden rounded-[1.75rem] flex flex-col">
                    <div className="bg-[#075E54] text-white p-3 flex items-center gap-2 text-xs font-medium">
                      <ArrowRight className="w-4 h-4 rotate-180" /> Te Stesso (Tu)
                    </div>
                    <div className="flex-1 p-3 flex flex-col justify-end gap-2 bg-[#EFEAE2]">
                      <div className="bg-white p-2 rounded-lg shadow-sm self-end w-3/4">
                        <div className="flex items-center gap-2 border-b pb-1 mb-1"><User className="w-4 h-4" /> <span className="text-xs font-bold">Andrea</span></div>
                        <div className="text-[10px] text-gray-500">Contatto</div>
                      </div>
                      <div className="bg-[#dcf8c6] p-2 rounded-lg shadow-sm self-end text-xs">
                        Ricorda appuntamento domani
                      </div>
                    </div>
                    <div className="bg-gray-100 p-2 flex gap-2 items-center">
                      <div className="bg-white flex-1 rounded-full h-8"></div>
                      <div className="w-8 h-8 bg-[#00a884] rounded-full flex items-center justify-center text-white"><Send className="w-3 h-3 ml-0.5" /></div>
                    </div>
                  </div>
                </div>
              </div>
              <div className="order-1 md:order-2">
                <div className="w-12 h-12 bg-primary/10 rounded-2xl flex items-center justify-center mb-6">
                  <span className="text-primary font-bold text-xl">2</span>
                </div>
                <h3 className="text-3xl font-bold mb-4">Invia un Contatto a Te Stesso</h3>
                <p className="text-text-secondary mb-8">Apri la chat con te stesso su WhatsApp. Allega il contatto della persona a cui vuoi scrivere, aggiungi il messaggio e invia.</p>
              </div>
            </div>
          </div>

          {/* Card 3 */}
          <div className="hiw-card bg-white rounded-[3rem] p-10 md:p-16 shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-gray-100 min-h-[60vh] flex flex-col justify-center relative z-30">
            <div className="grid md:grid-cols-2 gap-12 items-center">
              <div>
                <div className="w-12 h-12 bg-primary/10 rounded-2xl flex items-center justify-center mb-6">
                  <span className="text-primary font-bold text-xl">3</span>
                </div>
                <h3 className="text-3xl font-bold mb-4">Rilassati</h3>
                <p className="text-text-secondary mb-8">L'AI capisce quando inviare il messaggio. Tu non devi fare altro. Ti avviseremo quando sarà consegnato.</p>
                <div className="inline-flex items-center gap-2 bg-green-50 text-green-700 px-4 py-2 rounded-full text-sm font-medium">
                  <CheckCircle2 className="w-4 h-4" /> Tutti inviati con successo
                </div>
              </div>
              <div className="bg-background rounded-3xl p-8 flex flex-col gap-4">
                {[1,2,3].map((i) => (
                  <div key={i} className="bg-white p-4 rounded-2xl shadow-sm flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center"><Check className="w-5 h-5 text-primary" /></div>
                      <div>
                        <div className="text-sm font-bold">Messaggio inviato</div>
                        <div className="text-xs text-gray-500">Oggi, 09:00</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function ConnectionZone() {
  const [phoneInput, setPhoneInput] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [qrCode, setQrCode] = React.useState<string | null>(null);
  const [pairingCode, setPairingCode] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [status, setStatus] = React.useState<string>('disconnected');
  const pollRef = React.useRef<NodeJS.Timeout | null>(null);

  // Normalize phone: strip +, spaces, dashes — send raw digits to API (server handles prefix logic)
  const normalizePhone = (raw: string): string => raw.replace(/[\s\-().+]/g, '').trim();

  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  const pollStatus = () => {
    stopPolling();
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch('/api/connect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'getStatus' }),
        });
        if (res.ok) {
          const data = await res.json();
          if (data.status === 'connected' || data.state === 'open') {
            setStatus('connected');
            setQrCode(null);
            setPairingCode(null);
            stopPolling();
          }
        }
      } catch {}
    }, 3000);
  };

  const handleGetCode = async () => {
    const phone = normalizePhone(phoneInput);
    if (!phone) {
      setError('Inserisci il tuo numero di telefono');
      return;
    }
    setLoading(true);
    setError(null);
    setQrCode(null);
    setPairingCode(null);
    try {
      const res = await fetch('/api/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'getCodeAndPairing', phone: phone }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Errore durante la connessione');
      }
      const data = await res.json();
      if (data.qrCode) setQrCode(data.qrCode);
      if (data.pairingCode) setPairingCode(data.pairingCode);
      setStatus('connecting');
      pollStatus();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Errore sconosciuto');
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => {
    return () => stopPolling();
  }, []);

  return (
    <div className="py-20 bg-white">
      <div className="max-w-lg mx-auto px-4">
        <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-8">
          <h2 className="text-2xl font-bold text-gray-800 mb-2 text-center">Connetti WhatsApp</h2>
          <p className="text-gray-500 text-sm text-center mb-6">
            Inserisci il tuo numero per ricevere il codice di connessione
          </p>

          {status === 'connected' ? (
            <div className="text-center">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <p className="text-green-600 font-semibold text-lg">WhatsApp Connesso!</p>
              <p className="text-gray-500 text-sm mt-2">Il tuo dispositivo è stato collegato con successo.</p>
              <a href="/dashboard" className="mt-6 inline-block bg-green-500 text-white px-6 py-3 rounded-xl font-semibold hover:bg-green-600 transition-colors">
                Vai alla Dashboard
              </a>
            </div>
          ) : (
            <>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Numero di telefono
                </label>
                <input
                  type="tel"
                  value={phoneInput}
                  onChange={(e) => setPhoneInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !loading) handleGetCode(); }}
                  placeholder="+39 340 123 4567"
                  className="w-full border border-gray-300 rounded-xl px-4 py-3 text-gray-800 focus:outline-none focus:ring-2 focus:ring-green-400 text-lg"
                  disabled={loading || status === 'connecting'}
                  autoComplete="tel"
                />
                <p className="text-xs text-gray-400 mt-1">
                  Puoi scrivere: +39 340 123 4567 oppure 3401234567 oppure 393401234567
                </p>
              </div>

              <button
                onClick={handleGetCode}
                disabled={loading || !phoneInput.trim() || status === 'connecting'}
                className="w-full bg-green-500 text-white py-3 rounded-xl font-semibold hover:bg-green-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-base"
              >
                {loading ? 'Connessione in corso...' : status === 'connecting' ? 'In attesa di connessione...' : 'Connetti WhatsApp'}
              </button>

              {error && (
                <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm">
                  {error}
                </div>
              )}

              {(qrCode || pairingCode) && (
                <div className="mt-6 space-y-4">
                  {qrCode && (
                    <div className="text-center">
                      <p className="text-sm font-medium text-gray-700 mb-3">Scansiona il QR Code con WhatsApp:</p>
                      <div className="flex justify-center">
                        <img
                          src={`data:image/png;base64,${qrCode}`}
                          alt="QR Code WhatsApp"
                          className="w-52 h-52 border border-gray-200 rounded-xl"
                        />
                      </div>
                    </div>
                  )}

                  {pairingCode && (
                    <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-center">
                      <p className="text-sm font-medium text-gray-700 mb-2">Oppure usa il codice di abbinamento:</p>
                      <p className="text-3xl font-bold text-blue-600 tracking-widest">{pairingCode}</p>
                      <p className="text-xs text-gray-500 mt-2">
                        WhatsApp → Impostazioni → Dispositivi collegati → Collega un dispositivo → Inserisci codice
                      </p>
                    </div>
                  )}

                  <div className="flex items-center gap-2 text-sm text-amber-600 bg-amber-50 border border-amber-200 rounded-xl p-3">
                    <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span>Scansiona il QR o inserisci il codice entro 60 secondi</span>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function PricingSection() {
  return (
    <section id="prezzi" className="py-24 bg-white">
      <div className="max-w-4xl mx-auto px-6 text-center">
        <h2 className="text-4xl md:text-5xl font-bold text-text-primary mb-4">Un prezzo. Nessuna sorpresa.</h2>
        <p className="text-xl text-text-secondary font-serif italic mb-16">Semplice come inviare un messaggio.</p>

        <div className="max-w-md mx-auto bg-white rounded-[3rem] p-10 shadow-[0_20px_50px_rgba(0,0,0,0.08)] border border-primary/20 relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-2 bg-primary"></div>
          <h3 className="text-2xl font-bold mb-2">WhatsLater</h3>
          <div className="flex items-baseline justify-center gap-1 mb-8">
            <span className="text-5xl font-bold">€1.99</span>
            <span className="text-text-secondary">/mese</span>
          </div>

          <ul className="space-y-4 text-left mb-10">
            <li className="flex items-center gap-3"><CheckCircle2 className="w-5 h-5 text-primary" /> Messaggi illimitati*</li>
            <li className="flex items-center gap-3"><CheckCircle2 className="w-5 h-5 text-primary" /> Connessione QR Code o Codice</li>
            <li className="flex items-center gap-3"><CheckCircle2 className="w-5 h-5 text-primary" /> Linguaggio naturale AI</li>
            <li className="flex items-center gap-3"><CheckCircle2 className="w-5 h-5 text-primary" /> Coda messaggi in tempo reale</li>
            <li className="flex items-center gap-3"><CheckCircle2 className="w-5 h-5 text-primary" /> Supporto via WhatsApp</li>
          </ul>

          <a href="#connetti" className="block w-full bg-primary text-white py-4 rounded-2xl font-bold text-lg hover:scale-[1.02] transition-transform shadow-lg shadow-primary/30 mb-4">
            Inizia Ora — €1.99/mese
          </a>
          <p className="text-[10px] text-gray-400">*Soggetto a rate limiting di 15 msg/min per protezione account.</p>
        </div>

        <p className="mt-12 text-sm text-text-secondary">
          Hai un team o un business? <a href="https://wa.me/393442582226" className="text-primary font-medium hover:underline">Scrivici.</a>
        </p>
      </div>
    </section>
  );
}

function FAQSection() {
  const faqs = [
    { q: "Il mio WhatsApp è sicuro?", a: "Assolutamente sì. Usiamo lo stesso protocollo di WhatsApp Web. Non leggiamo i tuoi messaggi. I dati sono protetti con Row Level Security su database PostgreSQL." },
    { q: "Devo scansionare un QR Code?", a: "Puoi scegliere: scansiona un QR Code oppure inserisci un codice di abbinamento a 8 cifre direttamente su WhatsApp. Entrambi i metodi funzionano dal cellulare." },
    { q: "Cosa succede se il mio telefono è spento?", a: "Il messaggio resta in coda. Quando torni online, viene inviato automaticamente. Ti avvisiamo se qualcosa non va." },
    { q: "Posso annullare un messaggio programmato?", a: "Sì. Scrivi 'annulla' o 'cancella [nome]' nella chat con Te Stesso, oppure eliminalo dalla dashboard." },
    { q: "Come funziona l'AI?", a: "Scrivi in linguaggio naturale — 'domani alle 9', 'fra 2 ore', 'lunedì mattina' — e la nostra AI (GPT-4o Mini) capisce esattamente quando inviare." }
  ];

  const [openIndex, setOpenIndex] = useState<number | null>(0);

  return (
    <section id="faq" className="py-24 bg-background">
      <div className="max-w-3xl mx-auto px-6">
        <h2 className="text-4xl font-bold text-text-primary mb-12 text-center">Domande Frequenti</h2>
        <div className="space-y-4">
          {faqs.map((faq, i) => (
            <div key={i} className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
              <button 
                className="w-full px-6 py-5 text-left font-semibold flex justify-between items-center focus:outline-none"
                onClick={() => setOpenIndex(openIndex === i ? null : i)}
              >
                {faq.q}
                <ChevronDown className={cn("w-5 h-5 text-gray-400 transition-transform duration-300", openIndex === i && "rotate-180")} />
              </button>
              <div 
                className={cn("px-6 overflow-hidden transition-all duration-300 ease-in-out", openIndex === i ? "max-h-40 pb-5 opacity-100" : "max-h-0 opacity-0")}
              >
                <p className="text-text-secondary text-sm leading-relaxed">{faq.a}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="bg-text-primary text-white rounded-t-[4rem] pt-20 pb-10 px-6 mt-20">
      <div className="max-w-5xl mx-auto flex flex-col items-center text-center">
        <div className="flex items-center gap-2 font-bold text-2xl tracking-tight mb-4">
          <Calendar className="w-8 h-8 text-primary" />
          <span>WhatsLater</span>
        </div>
        <p className="text-gray-400 mb-12">Scrivi ora, invia dopo.</p>
        
        <div className="flex flex-wrap justify-center gap-8 text-sm font-medium text-gray-300 mb-16">
          <a href="#" className="hover:text-white transition-colors">Privacy Policy</a>
          <a href="#" className="hover:text-white transition-colors">Termini di Servizio</a>
          <a href="#" className="hover:text-white transition-colors">Contatti</a>
        </div>

        <div className="flex items-center gap-2 bg-white/10 px-4 py-2 rounded-full text-xs font-medium mb-8">
          <div className="w-2 h-2 bg-primary rounded-full animate-pulse"></div>
          Sistema Operativo
        </div>

        <div className="text-xs text-gray-500 space-y-2">
          <p>Made in Italy 🇮🇹 · Hosted on EU servers</p>
          <p>Copyright © 2026 WhatsLater</p>
        </div>
      </div>
    </footer>
  );
}

