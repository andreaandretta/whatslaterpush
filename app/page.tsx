'use client';
import Navbar from './components/Navbar';
import HeroSection from './components/HeroSection';
import StatsBar from './components/StatsBar';
import HowItWorksSection from './components/HowItWorksSection';
import TestimonialsSection from './components/TestimonialsSection';
import PricingSection from './components/PricingSection';
import FAQSection from './components/FAQSection';
import FinalCTA from './components/FinalCTA';
import Footer from './components/Footer';

// Landing layout — case-study direction.
// Rhythm: light hero (white+doodle) → cream stats → light how-it-works
//      → mint testimonials → light pricing → light FAQ → mint final CTA
//      → dark footer.
// Bookended by hero (light) and footer (dark); mint bands provide section
// punctuation without flat color repetition.
export default function Home() {
  return (
    <main className="min-h-screen bg-white">
      <Navbar />
      <HeroSection />
      <StatsBar />
      <HowItWorksSection />
      <TestimonialsSection />
      <PricingSection />
      <FAQSection />
      <FinalCTA />
      <Footer />
    </main>
  );
}
