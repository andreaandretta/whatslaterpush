'use client';
import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { cn } from '../lib/cn';
import {
  Calendar, MessageCircle, CheckCircle2, ArrowRight, Clock,
  Paperclip, User, Send
} from 'lucide-react';

if (typeof window !== 'undefined') {
  gsap.registerPlugin(gsap.plugins?.ScrollTrigger);
}

export default function HeroSection() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ctx = gsap.context(() => {
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

      gsap.from('.hero-text', {
        y: 50,
        opacity: 0,
        duration: 1,
        stagger: 0.2,
        ease: 'power3.out',
        delay: 0.2
      });

      gsap.from('.phone-mockup', {
        y: 100,
        opacity: 0,
        duration: 1.2,
        ease: 'back.out(1.2)',
        delay: 0.6
      });

      const tl = gsap.timeline({ repeat: -1, repeatDelay: 2 });

      tl.to('.phone-screen-lock', { opacity: 0, duration: 0.5, delay: 1 })
        .to('.wa-icon', { scale: 0.9, duration: 0.1, yoyo: true, repeat: 1 })
        .to('.home-screen', { opacity: 0, duration: 0.3 })
        .to('.wa-chats', { opacity: 1, duration: 0.3 })
        .to('.chat-self', { backgroundColor: 'rgba(0,0,0,0.05)', duration: 0.1, yoyo: true, repeat: 1 }, '+=0.5')
        .to('.wa-chats', { opacity: 0, duration: 0.3 })
        .to('.wa-inside-chat', { opacity: 1, duration: 0.3 })
        .to('.attach-icon', { scale: 0.8, duration: 0.1, yoyo: true, repeat: 1 }, '+=0.5')
        .to('.attach-menu', { y: 0, opacity: 1, duration: 0.3, ease: 'back.out(1.5)' })
        .to('.contact-btn', { scale: 0.9, duration: 0.1, yoyo: true, repeat: 1 }, '+=0.5')
        .to('.attach-menu', { y: 50, opacity: 0, duration: 0.2 })
        .fromTo('.contact-card-preview', { y: 50, opacity: 0 }, { y: 0, opacity: 1, duration: 0.4, ease: 'spring' })
        .to('.send-contact-btn', { scale: 0.9, duration: 0.1, yoyo: true, repeat: 1 }, '+=0.5')
        .to('.contact-card-preview', { opacity: 0, duration: 0.2 })
        .fromTo('.sent-contact', { scale: 0.8, opacity: 0, x: 20 }, { scale: 1, opacity: 1, x: 0, duration: 0.3, ease: 'back.out(1.5)' })
        .to('.typing-indicator', { opacity: 1, duration: 0.2 }, '+=0.5')
        .to('.chat-input-text', { text: "Ricorda l'appuntamento di domani alle 10:00", duration: 1.5, ease: 'none' })
        .to('.typing-indicator', { opacity: 0, duration: 0.1 })
        .to('.send-msg-btn', { scale: 0.8, duration: 0.1, yoyo: true, repeat: 1 }, '+=0.2')
        .to('.chat-input-text', { text: "", duration: 0.1 })
        .fromTo('.sent-msg', { scale: 0.8, opacity: 0, x: 20 }, { scale: 1, opacity: 1, x: 0, duration: 0.3, ease: 'back.out(1.5)' })
        .fromTo('.confirmation-badge', { y: 20, opacity: 0 }, { y: 0, opacity: 1, duration: 0.4, ease: 'back.out(1.5)' }, '+=0.5')
        .to({}, { duration: 3 });

    }, containerRef);
    return () => ctx.revert();
  }, []);

  return (
    <section ref={containerRef} className="relative min-h-[100dvh] flex flex-col items-center justify-center pt-20 overflow-hidden bg-gradient-to-b from-background via-[#e8f5e9] to-white">
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
          Programma i messaggi WhatsApp semplicemente chattando a te stesso. Nessuna complicazione. A partire da &euro;1.99/mese.
        </p>
      </div>

      {/* Phone Mockup */}
      <div className="phone-mockup relative mt-16 w-[300px] h-[600px] bg-black rounded-[3rem] border-[8px] border-black shadow-[0_20px_50px_rgba(0,0,0,0.2)] flex-shrink-0">
        <div className="absolute -left-[10px] top-24 w-1 h-8 bg-gray-800 rounded-l-md"></div>
        <div className="absolute -left-[10px] top-36 w-1 h-12 bg-gray-800 rounded-l-md"></div>
        <div className="absolute -left-[10px] top-52 w-1 h-12 bg-gray-800 rounded-l-md"></div>
        <div className="absolute -right-[10px] top-36 w-1 h-16 bg-gray-800 rounded-r-md"></div>
        <div className="absolute top-2 left-1/2 -translate-x-1/2 w-24 h-6 bg-black rounded-full z-50"></div>

        <div className="relative w-full h-full bg-[#EFEAE2] overflow-hidden font-sans text-sm rounded-[2.5rem]">
          <div className="phone-screen-lock absolute inset-0 bg-black/40 backdrop-blur-md z-40 flex flex-col items-center justify-center text-white">
            <Clock className="w-12 h-12 mb-2 opacity-80" />
            <div className="text-4xl font-light">09:41</div>
            <div className="text-sm mt-2 opacity-80">Scorri per sbloccare</div>
          </div>

          <div className="home-screen absolute inset-0 bg-gradient-to-b from-blue-400 to-blue-600 z-30 p-6 pt-16">
            <div className="grid grid-cols-4 gap-4">
              <div className="wa-icon w-12 h-12 bg-[#25D366] rounded-2xl flex items-center justify-center shadow-sm mx-auto">
                <MessageCircle className="w-7 h-7 text-white" fill="currentColor" />
              </div>
            </div>
          </div>

          <div className="wa-chats absolute inset-0 z-20 opacity-0 flex flex-col">
            <div className="bg-[#075E54] p-3 pt-8">
              <h3 className="text-white font-bold text-base">WhatsApp</h3>
            </div>
            <div className="flex-1 bg-white">
              <div className="chat-self p-3 border-b flex items-center gap-3 cursor-pointer">
                <div className="w-12 h-12 bg-primary/20 rounded-full flex items-center justify-center">
                  <User className="w-6 h-6 text-primary" />
                </div>
                <div className="flex-1">
                  <div className="font-semibold text-sm">Te Stesso (Tu)</div>
                  <div className="text-xs text-gray-500">Tocca per aprire</div>
                </div>
              </div>
            </div>
          </div>

          <div className="wa-inside-chat absolute inset-0 z-10 opacity-0 flex flex-col">
            <div className="bg-[#075E54] text-white p-3 pt-6 flex items-center gap-2">
              <ArrowRight className="w-4 h-4 rotate-180" />
              <div className="w-8 h-8 bg-primary/30 rounded-full flex items-center justify-center">
                <User className="w-4 h-4" />
              </div>
              <span className="font-semibold text-sm">Te Stesso</span>
            </div>

            <div className="flex-1 bg-[#EFEAE2] p-3 flex flex-col justify-end gap-2 relative overflow-hidden">
              <div className="attach-menu absolute bottom-20 left-3 right-3 bg-white rounded-2xl shadow-xl p-4 grid grid-cols-3 gap-4 opacity-0 translate-y-[50px] z-20">
                <div className="contact-btn flex flex-col items-center gap-1 cursor-pointer">
                  <div className="w-10 h-10 bg-blue-500 rounded-full flex items-center justify-center"><User className="w-5 h-5 text-white" /></div>
                  <span className="text-[10px]">Contatto</span>
                </div>
                <div className="flex flex-col items-center gap-1"><div className="w-10 h-10 bg-purple-500 rounded-full flex items-center justify-center"><Calendar className="w-5 h-5 text-white" /></div><span className="text-[10px]">Documento</span></div>
                <div className="flex flex-col items-center gap-1"><div className="w-10 h-10 bg-pink-500 rounded-full flex items-center justify-center"><Paperclip className="w-5 h-5 text-white" /></div><span className="text-[10px]">Galleria</span></div>
              </div>

              <div className="contact-card-preview opacity-0 bg-white rounded-xl p-3 shadow-sm border border-gray-100 z-10">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-8 h-8 bg-gray-200 rounded-full flex items-center justify-center"><User className="w-4 h-4 text-gray-500" /></div>
                  <div><div className="font-bold text-xs">Marco Rossi</div><div className="text-[10px] text-gray-500">+39 345 678 9012</div></div>
                </div>
                <button className="send-contact-btn w-full bg-[#25D366] text-white text-xs py-1.5 rounded-lg font-medium">Invia Contatto</button>
              </div>

              <div className="sent-contact opacity-0 self-end bg-[#dcf8c6] rounded-xl rounded-tr-none p-2 shadow-sm max-w-[80%]">
                <div className="flex items-center gap-2 border-b border-green-200 pb-1 mb-1">
                  <User className="w-4 h-4 text-gray-600" />
                  <span className="font-bold text-xs">Marco Rossi</span>
                </div>
                <div className="text-[10px] text-gray-500">Contatto</div>
                <div className="text-[9px] text-right text-gray-400 mt-0.5">09:41 ✓✓</div>
              </div>

              <div className="sent-msg opacity-0 self-end bg-[#dcf8c6] rounded-xl rounded-tr-none p-2 shadow-sm max-w-[85%]">
                <div className="text-xs">Ricorda l&apos;appuntamento di domani alle 10:00</div>
                <div className="text-[9px] text-right text-gray-400 mt-0.5">09:41 ✓✓</div>
              </div>

              <div className="confirmation-badge opacity-0 self-center bg-white/90 backdrop-blur-sm px-4 py-2 rounded-full shadow-lg text-xs font-medium text-primary flex items-center gap-2 z-30">
                <CheckCircle2 className="w-4 h-4" /> Programmato per domani, 10:00
              </div>
            </div>

            <div className="bg-[#F0F0F0] p-2 flex items-center gap-2">
              <div className="attach-icon cursor-pointer"><Paperclip className="w-5 h-5 text-gray-500" /></div>
              <div className="flex-1 bg-white rounded-full px-3 py-1.5 flex items-center min-h-[32px]">
                <span className="chat-input-text text-xs text-gray-800"></span>
                <span className="typing-indicator opacity-0 flex gap-0.5 ml-1">
                  <span className="w-1 h-1 bg-gray-400 rounded-full animate-bounce"></span>
                  <span className="w-1 h-1 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></span>
                  <span className="w-1 h-1 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></span>
                </span>
              </div>
              <div className="send-msg-btn w-8 h-8 bg-[#25D366] rounded-full flex items-center justify-center cursor-pointer">
                <Send className="w-4 h-4 text-white ml-0.5" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
