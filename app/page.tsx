import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Calendar, Clock, Shield, Zap, MessageCircle, ArrowRight } from 'lucide-react'
import { Button } from '@/components/Button'

export default async function HomePage() {
  // Check if user is authenticated
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (user) {
    redirect('/dashboard')
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Navigation */}
      <nav className="bg-surface border-b border-border-soft">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center">
              <Calendar className="w-5 h-5 text-white" />
            </div>
            <span className="text-xl font-bold text-text-primary">SchedWhats</span>
          </div>
          <div className="flex items-center gap-4">
            <a
              href="/login"
              className="text-text-secondary hover:text-text-primary transition-colors"
            >
              Sign In
            </a>
            <Button asChild>
              <a href="/signup">Get Started</a>
            </Button>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="py-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-4xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 text-primary text-sm font-medium mb-8">
            <Zap className="w-4 h-4" />
            <span>v7.0 Design Edition</span>
          </div>

          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-text-primary mb-6 leading-tight">
            Schedule WhatsApp Messages{' '}
            <span className="text-primary">Effortlessly</span>
          </h1>

          <p className="text-lg sm:text-xl text-text-secondary mb-10 max-w-2xl mx-auto">
            Send contact cards to your Note to Self with natural language like 
            &quot;Tomorrow at 9am&quot; and let AI handle the scheduling.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Button size="lg" className="gap-2" asChild>
              <a href="/signup">
                Start Scheduling Free
                <ArrowRight className="w-5 h-5" />
              </a>
            </Button>
            <Button variant="outline" size="lg" asChild>
              <a href="/login">Sign In</a>
            </Button>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="py-20 px-4 sm:px-6 lg:px-8 bg-surface">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-3xl font-bold text-text-primary text-center mb-16">
            How It Works
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              {
                icon: MessageCircle,
                title: 'Share Contact',
                description: 'Send a contact card (vCard) to your WhatsApp Note to Self',
              },
              {
                icon: Clock,
                title: 'Add Caption',
                description: 'Write when to send: "Tomorrow at 9am", "Friday 3pm", etc.',
              },
              {
                icon: Zap,
                title: 'AI Schedules',
                description: 'Our AI parses the date and schedules the message automatically',
              },
            ].map((step, index) => (
              <div
                key={index}
                className="bg-background rounded-3xl p-8 text-center shadow-soft hover:shadow-soft-lg transition-shadow"
              >
                <div className="w-16 h-16 mx-auto mb-6 rounded-2xl bg-primary/10 flex items-center justify-center">
                  <step.icon className="w-8 h-8 text-primary" />
                </div>
                <h3 className="text-xl font-semibold text-text-primary mb-3">
                  {step.title}
                </h3>
                <p className="text-text-secondary">{step.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-3xl font-bold text-text-primary text-center mb-16">
            Features
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              {
                icon: Clock,
                title: 'Natural Language',
                description: 'Type dates naturally like humans do',
              },
              {
                icon: Shield,
                title: 'Secure',
                description: 'End-to-end encryption, RLS protection',
              },
              {
                icon: Zap,
                title: 'AI Powered',
                description: 'GPT-4o Mini parses your dates intelligently',
              },
              {
                icon: Calendar,
                title: 'Smart Jitter',
                description: 'Random delays prevent message flooding',
              },
            ].map((feature, index) => (
              <div
                key={index}
                className="bg-surface rounded-2xl p-6 shadow-card hover:shadow-soft transition-shadow"
              >
                <feature.icon className="w-8 h-8 text-primary mb-4" />
                <h3 className="font-semibold text-text-primary mb-2">
                  {feature.title}
                </h3>
                <p className="text-sm text-text-secondary">{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 px-4 sm:px-6 lg:px-8 bg-surface">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-3xl font-bold text-text-primary mb-6">
            Ready to Schedule Smarter?
          </h2>
          <p className="text-text-secondary mb-10 max-w-xl mx-auto">
            Join thousands of users who trust SchedWhats for their WhatsApp scheduling needs.
          </p>
          <Button size="lg" className="gap-2" asChild>
            <a href="/signup">
              Get Started Free
              <ArrowRight className="w-5 h-5" />
            </a>
          </Button>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-8 px-4 sm:px-6 lg:px-8 border-t border-border-soft">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Calendar className="w-5 h-5 text-primary" />
            <span className="font-semibold text-text-primary">SchedWhats</span>
          </div>
          <p className="text-sm text-text-secondary">
            © 2024 SchedWhats. Built with Modern Soft UI.
          </p>
        </div>
      </footer>
    </div>
  )
}
