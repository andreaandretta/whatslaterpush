// @ts-nocheck
'use client'
import { useEffect, useState, useRef } from 'react'
import React from 'react'

export default function DashboardPage() {
  const [status, setStatus] = useState('disconnected')
  const [qrCode, setQrCode] = useState(null)
  const [pairingCode, setPairingCode] = useState(null)
  const [instanceName] = useState('SchedWhats-Primary')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState(null)
  const refreshTimer = useRef(null)

  useEffect(() => {
    checkStatus()
    return () => { if (refreshTimer.current) clearInterval(refreshTimer.current) }
  }, [])

  const checkStatus = async () => {
    try {
      const res = await fetch('/api/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'status', instanceName }),
      })
      const result = await res.json()
      if (result.success) {
        const state = (result.data?.status || '').toLowerCase()
        if (state === 'open' || state === 'connected') {
          setStatus('connected'); setQrCode(null); setPairingCode(null)
          if (refreshTimer.current) clearInterval(refreshTimer.current)
        }
      }
    } catch (e) { /* ignore */ }
  }

  const handleGetCode = async () => {
    setIsLoading(true); setError(null)
    try {
      const res = await fetch('/api/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'getCode', instanceName }),
      })
      const result = await res.json()
      if (result.success && result.data) {
        setStatus('connecting')
        if (result.data.qrCode) {
          const qr = result.data.qrCode
          setQrCode(qr.startsWith('data:') ? qr : 'data:image/png;base64,' + qr)
        }
        if (result.data.pairingCode) setPairingCode(result.data.pairingCode)
        if (refreshTimer.current) clearInterval(refreshTimer.current)
        refreshTimer.current = setInterval(async () => {
          try {
            const sr = await fetch('/api/connect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'status', instanceName }) })
            const sRes = await sr.json()
            const st = (sRes.data?.status || '').toLowerCase()
            if (st === 'open' || st === 'connected') { setStatus('connected'); setQrCode(null); setPairingCode(null); if (refreshTimer.current) clearInterval(refreshTimer.current); return }
            const rr = await fetch('/api/connect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'getCode', instanceName }) })
            const rRes = await rr.json()
            if (rRes.success && rRes.data?.qrCode) { const q = rRes.data.qrCode; setQrCode(q.startsWith('data:') ? q : 'data:image/png;base64,' + q) }
          } catch (e) { /* ignore */ }
        }, 20000)
      } else { setError(result.error || 'Failed to get QR code') }
    } catch (e) { setError('Connection failed.') }
    finally { setIsLoading(false) }
  }

  const handleDisconnect = async () => {
    try { await fetch('/api/connect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'disconnect', instanceName }) }) } catch (e) { /* ignore */ }
    setStatus('disconnected'); setQrCode(null); setPairingCode(null)
    if (refreshTimer.current) clearInterval(refreshTimer.current)
  }

  const C = React.createElement
  const colors = { disconnected: 'bg-red-100 text-red-700', connecting: 'bg-orange-100 text-orange-700', connected: 'bg-green-100 text-green-700' }

  return C('div', { className: 'min-h-screen bg-gray-50' },
    C('header', { className: 'bg-white border-b border-gray-200 sticky top-0 z-10' },
      C('div', { className: 'max-w-5xl mx-auto px-4 h-16 flex items-center justify-between' },
        C('h1', { className: 'text-xl font-bold text-gray-900' }, 'SchedWhats'),
        C('span', { className: 'px-3 py-1.5 rounded-full text-sm font-medium border ' + (colors[status] || '') }, status)
      )
    ),
    C('main', { className: 'max-w-5xl mx-auto px-4 py-8' },
      C('div', { className: 'grid grid-cols-1 lg:grid-cols-3 gap-8' },
        C('div', { className: 'lg:col-span-1' },
          C('div', { className: 'bg-white rounded-3xl shadow-sm border border-gray-100 p-8' },
            C('h2', { className: 'text-xl font-semibold text-gray-900 mb-6' }, 'Connect WhatsApp'),
            status === 'connected'
              ? C('div', { className: 'text-center py-8' },
                  C('div', { className: 'text-5xl mb-4' }, String.fromCodePoint(0x2705)),
                  C('h3', { className: 'text-lg font-semibold text-green-700 mb-4' }, 'Connected!'),
                  C('button', { onClick: handleDisconnect, className: 'px-4 py-2 text-sm border rounded-xl hover:bg-gray-50' }, 'Disconnect')
                )
              : C('div', { className: 'space-y-5' },
                  qrCode ? C('div', { className: 'border-2 border-green-100 rounded-2xl p-6 text-center' },
                    C('p', { className: 'text-sm text-gray-500 mb-4' }, 'Scan with WhatsApp'),
                    C('img', { src: qrCode, alt: 'QR Code', className: 'w-56 h-56 mx-auto rounded-xl' }),
                    C('p', { className: 'text-xs text-green-600 mt-2 animate-pulse' }, 'Auto-refreshing every 20s...')
                  ) : null,
                  pairingCode ? C('div', { className: 'bg-green-50 border border-green-200 rounded-2xl p-6 text-center' },
                    C('p', { className: 'text-sm text-gray-600 mb-3' }, 'Pairing code:'),
                    C('div', { className: 'text-3xl font-bold text-green-700 font-mono tracking-widest' }, pairingCode)
                  ) : null,
                  error ? C('div', { className: 'bg-red-50 border border-red-200 rounded-xl p-4 text-center text-sm text-red-600' }, error) : null,
                  C('button', { onClick: handleGetCode, disabled: isLoading, className: 'w-full h-14 text-lg font-semibold rounded-2xl bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 transition-colors' },
                    isLoading ? 'Generating...' : qrCode ? 'Refresh QR Code' : 'Get Code')
                )
          ),
          C('div', { className: 'mt-6 bg-white rounded-3xl shadow-sm border border-gray-100 p-6' },
            C('h3', { className: 'font-semibold text-gray-900 mb-3' }, 'How it works'),
            C('p', { className: 'text-sm text-gray-500' }, '1. Click Get Code  2. Scan QR  3. Send vCard+date to Note to Self  4. We schedule it!')
          )
        ),
        C('div', { className: 'lg:col-span-2' },
          C('h2', { className: 'text-xl font-semibold text-gray-900 mb-6' }, 'Scheduled Messages'),
          C('div', { className: 'bg-white rounded-3xl shadow-sm border border-gray-100 p-12 text-center' },
            C('p', { className: 'text-gray-500' }, status === 'connected' ? 'Send a vCard to Note to Self to schedule messages.' : 'Connect WhatsApp first to start scheduling.')
          )
        )
      )
    )
  )
          }
