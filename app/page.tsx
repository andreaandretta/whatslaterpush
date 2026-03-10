'use client';

import React from 'react';
import Navbar from './components/Navbar';
import HeroSection from './components/HeroSection';
import FeaturesSection from './components/FeaturesSection';
import PhilosophySection from './components/PhilosophySection';
import HowItWorksSection from './components/HowItWorksSection';
import PricingSection from './components/PricingSection';
import FAQSection from './components/FAQSection';
import Footer from './components/Footer';

export default function HomePage() {
  return (
    <div className="min-h-screen bg-background text-text-primary font-sans selection:bg-primary/20 selection:text-accent overflow-hidden">
      <Navbar />
      <HeroSection />
      <FeaturesSection />
      <PhilosophySection />
      <HowItWorksSection />
      <section id="connetti" className="py-24 bg-gradient-to-b from-background to-[#e8f5e9]">
        <div className="max-w-3xl mx-auto px-6 text-center">
          <h2 className="text-4xl font-bold text-text-primary mb-4">Pronto a iniziare?</h2>
          <p className="text-text-secondary mb-8">Connetti il tuo WhatsApp in 30 secondi e programma il tuo primo messaggio.</p>
          <a
            href="/dashboard"
            className="inline-block bg-primary text-white px-8 py-4 rounded-2xl font-bold text-lg hover:scale-[1.02] transition-transform shadow-lg shadow-primary/30"
          >
            Connetti WhatsApp
          </a>
        </div>
      </section>
      <PricingSection />
      <FAQSection />
      <Footer />
    </div>
  );
}
