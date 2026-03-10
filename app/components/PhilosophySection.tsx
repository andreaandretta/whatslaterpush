'use client';
import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

if (typeof window !== 'undefined') {
  gsap.registerPlugin(ScrollTrigger);
}

export default function PhilosophySection() {
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
          WhatsLater &egrave; il gesto di cura programmata. Nessun compleanno dimenticato. Nessun follow-up perso. Nessun buongiorno mancato perch&eacute; erano le 2 di notte. Costa meno di un caff&egrave; al mese.
        </p>
      </div>
    </section>
  );
}
