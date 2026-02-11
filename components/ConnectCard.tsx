'use client'

import { useState } from 'react'
import { Smartphone, Loader2, CheckCircle2, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from './Button'
import { Input } from './Input'

interface ConnectCardProps {
  onConnect: (phoneNumber: string) => Promise<void>
  isConnecting: boolean
  pairingCode?: string
  qrCode?: string
  status?: string
}

export function ConnectCard({
  onConnect,
  isConnecting,
  pairingCode,
  qrCode,
  status,
}: ConnectCardProps) {
  const [phoneNumber, setPhoneNumber] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (phoneNumber.trim()) {
      await onConnect(phoneNumber.trim())
    }
  }

  const isConnected = status === 'connected'
  const isAwaitingCode = status === 'connecting' && pairingCode
  const isAwaitingQR = status === 'awaiting_qr' && qrCode

  return (
    <div className="bg-surface rounded-3xl shadow-soft p-8 transition-all duration-300 hover:shadow-soft-lg">
      <div className="flex items-center gap-4 mb-6">
        <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center">
          <Smartphone className="w-7 h-7 text-primary" />
        </div>
        <div>
          <h2 className="text-xl font-semibold text-text-primary">Connect WhatsApp</h2>
          <p className="text-sm text-text-secondary mt-1">
            Link your WhatsApp to start scheduling
          </p>
        </div>
      </div>

      {isConnected ? (
        <div className="text-center py-8">
          <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-success-light flex items-center justify-center">
            <CheckCircle2 className="w-10 h-10 text-success-dark" />
          </div>
          <h3 className="text-lg font-semibold text-success-dark mb-2">
            WhatsApp Connected!
          </h3>
          <p className="text-text-secondary mb-4">
            Your WhatsApp is ready for scheduling
          </p>
          <Button
            variant="outline"
            onClick={() => onConnect(phoneNumber)}
            className="gap-2"
          >
            <RefreshCw className="w-4 h-4" />
            Reconnect
          </Button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-sm font-medium text-text-primary mb-2">
              Phone Number
            </label>
            <Input
              type="tel"
              placeholder="+1 234 567 890"
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
              disabled={isConnecting || isAwaitingCode}
              className={cn(
                "text-lg tracking-wide",
                isAwaitingCode && "border-primary/50 bg-primary/5"
              )}
            />
            <p className="text-xs text-text-secondary mt-2">
              Include country code (e.g., +1 for US)
            </p>
          </div>

          {isAwaitingCode && pairingCode && (
            <div className="bg-primary/5 border border-primary/20 rounded-2xl p-6 text-center animate-fade-in">
              <p className="text-sm text-text-secondary mb-3">Your pairing code</p>
              <div className="text-4xl font-bold text-primary tracking-[0.5em] font-mono">
                {pairingCode}
              </div>
              <p className="text-sm text-text-secondary mt-4">
                Open WhatsApp → Settings → Linked Devices → Link with phone number
              </p>
            </div>
          )}

          {isAwaitingQR && qrCode && (
            <div className="bg-surface border border-border-soft rounded-2xl p-6 text-center animate-fade-in">
              <p className="text-sm text-text-secondary mb-4">Scan with WhatsApp</p>
              <img
                src={qrCode}
                alt="WhatsApp QR Code"
                className="w-48 h-48 mx-auto rounded-xl"
              />
              <p className="text-sm text-text-secondary mt-4">
                WhatsApp → Settings → Linked Devices → Link a Device
              </p>
            </div>
          )}

          <Button
            type="submit"
            disabled={isConnecting || !phoneNumber.trim() || isAwaitingCode}
            isLoading={isConnecting}
            className="w-full h-14 text-lg"
          >
            {isAwaitingCode ? 'Waiting for connection...' : 'Get Code'}
          </Button>
        </form>
      )}
    </div>
  )
}
