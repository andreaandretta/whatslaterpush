'use client'

import { useEffect, useState, useCallback } from 'react'
import { User, LogOut, RefreshCw, Calendar } from 'lucide-react'
import { ConnectCard } from '@/components/ConnectCard'
import { QueueList } from '@/components/QueueList'
import { Button } from '@/components/Button'
import { createClient } from '@/lib/supabase/client'
import { ScheduledMessage, WhatsappInstance } from '@/types'
import { formatPhoneNumber } from '@/lib/utils'

export default function DashboardPage() {
  const supabase = createClient()
  
  // State
  const [user, setUser] = useState<{ email: string; id: string } | null>(null)
  const [instance, setInstance] = useState<WhatsappInstance | null>(null)
  const [messages, setMessages] = useState<ScheduledMessage[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isConnecting, setIsConnecting] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)

  // Fetch user data
  useEffect(() => {
    const getUser = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        setUser({ email: user.email || '', id: user.id })
      }
    }
    getUser()
  }, [])

  // Fetch instance and messages
  const fetchData = useCallback(async () => {
    if (!user?.id) return

    setIsRefreshing(true)
    
    try {
      // Fetch WhatsApp instance
      const { data: instances } = await supabase
        .from('whatsapp_instances')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(1)

      if (instances && instances.length > 0) {
        setInstance(instances[0])
      }

      // Fetch scheduled messages
      const { data: msgs } = await supabase
        .from('scheduled_messages')
        .select('*')
        .eq('user_id', user.id)
        .order('scheduled_at', { ascending: false })
        .limit(50)

      if (msgs) {
        setMessages(msgs)
      }
    } catch (error) {
      console.error('Error fetching data:', error)
    } finally {
      setIsLoading(false)
      setIsRefreshing(false)
    }
  }, [user?.id])

  useEffect(() => {
    if (user) {
      fetchData()
    }
  }, [user, fetchData])

  // Real-time subscription for messages
  useEffect(() => {
    if (!user?.id) return

    const subscription = supabase
      .channel('scheduled_messages')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'scheduled_messages',
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            setMessages((prev) => [payload.new as ScheduledMessage, ...prev])
          } else if (payload.eventType === 'UPDATE') {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === payload.new.id ? (payload.new as ScheduledMessage) : m
              )
            )
          } else if (payload.eventType === 'DELETE') {
            setMessages((prev) =>
              prev.filter((m) => m.id !== payload.old.id)
            )
          }
        }
      )
      .subscribe()

    return () => {
      subscription.unsubscribe()
    }
  }, [user?.id])

  // Handle connect
  const handleConnect = async (phoneNumber: string) => {
    setIsConnecting(true)
    try {
      const response = await fetch('/api/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phoneNumber: formatPhoneNumber(phoneNumber),
        }),
      })

      const result = await response.json()

      if (result.success) {
        setInstance({
          id: result.data.instanceId,
          user_id: user?.id || '',
          instance_name: result.data.instanceName,
          status: result.data.status,
          pairing_code: result.data.pairingCode,
          qr_code: result.data.qrCode,
          phone_number: phoneNumber,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        } as WhatsappInstance)
      } else {
        alert(result.error || 'Failed to connect')
      }
    } catch (error) {
      console.error('Connection error:', error)
      alert('Connection failed')
    } finally {
      setIsConnecting(false)
    }
  }

  // Handle cancel message
  const handleCancel = async (id: string) => {
    try {
      const { error } = await supabase
        .from('scheduled_messages')
        .update({ status: 'cancelled' })
        .eq('id', id)

      if (error) throw error
    } catch (error) {
      console.error('Cancel error:', error)
      alert('Failed to cancel message')
    }
  }

  // Handle logout
  const handleLogout = async () => {
    await supabase.auth.signOut()
    window.location.href = '/'
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="bg-surface border-b border-border-soft sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center">
              <Calendar className="w-5 h-5 text-white" />
            </div>
            <h1 className="text-xl font-bold text-text-primary">SchedWhats</h1>
          </div>

          <div className="flex items-center gap-4">
            <button
              onClick={fetchData}
              disabled={isRefreshing}
              className="p-2 rounded-xl text-text-secondary hover:text-text-primary hover:bg-background transition-colors"
              title="Refresh"
            >
              <RefreshCw className={`w-5 h-5 ${isRefreshing ? 'animate-spin' : ''}`} />
            </button>

            <div className="flex items-center gap-3 pl-4 border-l border-border-soft">
              <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center">
                <User className="w-5 h-5 text-primary" />
              </div>
              <span className="hidden sm:block text-sm text-text-secondary">
                {user?.email}
              </span>
            </div>

            <Button
              variant="ghost"
              size="sm"
              onClick={handleLogout}
              className="gap-2"
            >
              <LogOut className="w-4 h-4" />
              <span className="hidden sm:inline">Logout</span>
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Left Column - Connect Card */}
          <div className="lg:col-span-1">
            <ConnectCard
              onConnect={handleConnect}
              isConnecting={isConnecting}
              pairingCode={instance?.pairing_code || undefined}
              qrCode={instance?.qr_code || undefined}
              status={instance?.status}
            />

            {/* Quick Help Card */}
            <div className="mt-6 bg-surface rounded-3xl shadow-soft p-6">
              <h3 className="font-semibold text-text-primary mb-3">How to Schedule</h3>
              <ol className="space-y-2 text-sm text-text-secondary">
                <li className="flex gap-2">
                  <span className="font-medium text-primary">1.</span>
                  Open WhatsApp → Your Note to Self chat
                </li>
                <li className="flex gap-2">
                  <span className="font-medium text-primary">2.</span>
                  Attach a Contact (vCard)
                </li>
                <li className="flex gap-2">
                  <span className="font-medium text-primary">3.</span>
                  Write caption like "Tomorrow at 9am"
                </li>
                <li className="flex gap-2">
                  <span className="font-medium text-primary">4.</span>
                  Send and we&apos;ll schedule it!
                </li>
              </ol>
            </div>
          </div>

          {/* Right Column - Queue */}
          <div className="lg:col-span-2">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-semibold text-text-primary">
                Scheduled Messages
              </h2>
              <span className="text-sm text-text-secondary">
                {messages.length} message{messages.length !== 1 ? 's' : ''}
              </span>
            </div>

            <QueueList
              messages={messages}
              onCancel={handleCancel}
              isLoading={isLoading}
            />
          </div>
        </div>
      </main>
    </div>
  )
}
