import Navbar from './components/Navbar';
import HeroSection from './components/HeroSection';
import StatsBar from './components/StatsBar';
import HowItWorksSection from './components/HowItWorksSection';
import TestimonialsSection from './components/TestimonialsSection';
import SocialProofRow from './components/SocialProofRow';
import PricingSection from './components/PricingSection';
import BetaPricingNotice from './components/BetaPricingNotice';
import FAQSection from './components/FAQSection';
import FinalCTA from './components/FinalCTA';
import Footer from './components/Footer';
import { isBillingEnabled } from './lib/billing';

// Landing layout — case-study direction.
// Rhythm: light hero (white+doodle) → cream stats → light how-it-works
//      → mint testimonials → light pricing → light FAQ → mint final CTA
//      → dark footer.
// Bookended by hero (light) and footer (dark); mint bands provide section
// punctuation without flat color repetition.
//
// SERVER component (no 'use client'): this is the only place the landing
// reads the billing kill-switch — a client component would see
// process.env.BILLING_ENABLED inlined to undefined and always render the
// pricing grid. The flag flows down to the client children as plain props.
// The logged-in redirect to /dashboard lives in middleware.ts, not here.
export default function Home() {
  const billingEnabled = isBillingEnabled();
  return (
    <main className="min-h-screen bg-white">
      <Navbar />
      <HeroSection />
      <StatsBar />
      <HowItWorksSection />
      <TestimonialsSection billingEnabled={billingEnabled} />
      {/* TODO: passare numeri reali (users / messages / rating) — finché vuoto il componente non si monta */}
      <SocialProofRow />
      {billingEnabled ? <PricingSection /> : <BetaPricingNotice />}
      <FAQSection billingEnabled={billingEnabled} />
      <FinalCTA billingEnabled={billingEnabled} />
      <Footer />
    </main>
  );
}
