// @ts-nocheck
'use client'
import { useEffect, useState, useRef, useCallback } from 'react'
import React from 'react'

export default function DashboardPage() {
    const [status, setStatus] = useState('disconnected')
    const [qrCode, setQrCode] = useState(null)
    const [pairingCode, setPairingCode] = useState(null)
    const [instanceName] = useState('SchedWhats-Primary')
    const [isLoading, setIsLoading] = useState(false)
    const [error, setError] = useState(null)
    const refreshTimer = useRef(null)
    const [messages, setMessages] = useState([])
    const [messagesLoading, setMessagesLoading] = useState(true)
    const msgTimer = useRef(null)
    const [subscription, setSubscription] = useState({ status: 'unknown', trial_ends_at: null, expired: false })
    const [userPhone, setUserPhone] = useState('')

  const fetchMessages = useCallback(async () => {
        try {
                const phone = userPhone || localStorage.getItem('schedwhats_phone') || ''
                const url = phone ? `/api/messages?phone=${encodeURIComponent(phone)}` : '/api/messages'
                const res = await fetch(url)

          if (res.status === 403) {
                    const errData = await res.json()
                    setSubscription({ status: errData.subscription_status || 'expired', trial_ends_at: errData.trial_ends_at, expired: true })
                    setMessages([])
                    return
          }

          if (res.ok) {
                    const data = await res.json()
                    if (data.messages) {
                                setMessages(Array.isArray(data.messages) ? data.messages : [])
                                setSubscription({ status: data.subscription_status || 'unknown', trial_ends_at: data.trial_ends_at, expired: false })
                    } else {
                                setMessages(Array.isArray(data) ? data : [])
                    }
          }
        } catch (e) { /* ignore */ }
        finally { setMessagesLoading(false) }
  }, [userPhone])

  useEffect(() => {
        const saved = localStorage.getItem('schedwhats_phone')
        if (saved) setUserPhone(saved)
        checkStatus()
        fetchMessages()
        msgTimer.current = setInterval(fetchMessages, 30000)
        return () => {
                if (refreshTimer.current) clearInterval(refreshTimer.current)
                if (msgTimer.current) clearInterval(msgTimer.current)
        }
  }, [fetchMessages])

  const savePhone = (phone) => {
        setUserPhone(phone)
        localStorage.setItem('schedwhats_phone', phone)
  }

  const handleCancel = async (id) => {
        try {
                await fetch('/api/messages', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, status: 'cancelled', phone: userPhone }) })
                fetchMessages()
        } catch (e) { /* ignore */ }
  }

  const handleDelete = async (id) => {
        try {
                await fetch('/api/messages', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, phone: userPhone }) })
                fetchMessages()
        } catch (e) { /* ignore */ }
  }

  const checkStatus = async () => {
        try {
                const res = await fetch('/api/connect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'status', instanceName }) })
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
                const res = await fetch('/api/connect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'getCode', instanceName }) })
                const result = await res.json()
                if (result.success && result.data) {
                          setStatus('connecting')
                          if (result.data.qrCode) { const qr = result.data.qrCode; setQrCode(qr.startsWith('data:') ? qr : 'data:image/png;base64,' + qr) }
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
    const statusColors = { pending: 'bg-yellow-100 text-yellow-800', sent: 'bg-green-100 text-green-800', failed: 'bg-red-100 text-red-800', cancelled: 'bg-gray-100 text-gray-600' }
    const formatDate = (d) => { try { return new Date(d).toLocaleString() } catch(e) { return d } }
    const truncate = (s, n) => { if (!s) return ''; return s.length > n ? s.substring(0, n) + '...' : s }

  const getDaysLeft = () => {
        if (!subscription.trial_ends_at) return 0
        return Math.max(0, Math.ceil((new Date(subscription.trial_ends_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
  }

  const renderSubscriptionBanner = () => {
        if (subscription.expired) {
                return C('div', { className: 'bg-red-50 border border-red-200 rounded-2xl p-4 mb-6' },
                                 C('div', { className: 'flex items-center justify-between' },
                                             C('div', null,
                                                           C('p', { className: 'font-semibold text-red-700' }, 'Trial Expired'),
                                                           C('p', { className: 'text-sm text-red-600' }, 'Your 7-day free trial has ended. Subscribe to continue scheduling messages.')
                                                         ),
                                             C('a', { href: '#payment', className: 'px-4 py-2 bg-green-600 text-white rounded-xl font-medium hover:bg-green-700 transition-colors text-sm' }, 'Subscribe - \u20AC1.99/mo')
                                           )
                               )
        }
        if (subscription.status === 'trial' && subscription.trial_ends_at) {
                const days = getDaysLeft()
                return C('div', { className: 'bg-blue-50 border border-blue-200 rounded-2xl p-3 mb-6 flex items-center justify-between' },
                                 C('p', { className: 'text-sm text-blue-700' }, `Free trial: ${days} day${days !== 1 ? 's' : ''} remaining`),
                                 C('a', { href: '#payment', className: 'text-sm text-blue-600 underline' }, 'Upgrade now')
                               )
        }
        if (subscription.status === 'active') {
                return C('div', { className: 'bg-green-50 border border-green-200 rounded-2xl p-3 mb-6' },
                                 C('p', { className: 'text-sm text-green-700' }, 'Subscription active')
                               )
        }
        return null
  }

  const renderPhoneInput = () => {
        if (userPhone) return null
        return C('div', { className: 'bg-yellow-50 border border-yellow-200 rounded-2xl p-4 mb-6' },
                       C('p', { className: 'text-sm text-yellow-700 mb-2' }, 'Enter your WhatsApp phone number to view your messages:'),
                       C('div', { className: 'flex gap-2' },
                                 C('input', { type: 'text', placeholder: 'e.g. 393401234567', className: 'flex-1 px-3 py-2 border rounded-xl text-sm', id: 'phone-input' }),
                                 C('button', { onClick: () => { const v = document.getElementById('phone-input')?.value; if (v) savePhone(v) }, className: 'px-4 py-2 bg-green-600 text-white rounded-xl text-sm font-medium' }, 'Load My Messages')
                               )
                     )
  }

  const renderMessages = () => {
        if (subscription.expired) {
                return C('div', { className: 'bg-white rounded-3xl shadow-sm border border-gray-100 p-12 text-center' },
                                 C('p', { className: 'text-gray-500' }, 'Messages are locked. Subscribe to view and schedule messages.')
                               )
        }
        if (messagesLoading) {
                return C('div', { className: 'bg-white rounded-3xl shadow-sm border border-gray-100 p-12 text-center' },
                                 C('p', { className: 'text-gray-400 animate-pulse' }, 'Loading messages...')
                               )
        }
        if (messages.length === 0) {
                return C('div', { className: 'bg-white rounded-3xl shadow-sm border border-gray-100 p-12 text-center' },
                                 C('p', { className: 'text-gray-500' }, status === 'connected' ? 'No scheduled messages yet. Send a vCard to Note to Self!' : 'Connect WhatsApp first to start scheduling.')
                               )
        }
        return C('div', { className: 'space-y-3' }, ...messages.map((msg) =>
                C('div', { key: msg.id, className: 'bg-white rounded-2xl shadow-sm border border-gray-100 p-5' },
                          C('div', { className: 'flex items-start justify-between gap-4' },
                                      C('div', { className: 'flex-1 min-w-0' },
                                                    C('div', { className: 'flex items-center gap-2 mb-1' },
                                                                    C('span', { className: 'font-medium text-gray-900 truncate' }, msg.recipient_name || msg.recipient_number || 'Unknown'),
                                                                    C('span', { className: 'px-2 py-0.5 rounded-full text-xs font-medium ' + (statusColors[msg.status] || 'bg-gray-100 text-gray-600') }, msg.status)
                                                                  ),
                                                    C('p', { className: 'text-sm text-gray-600 mb-1' }, truncate(msg.parsed_message || msg.caption || '', 80)),
                                                    C('p', { className: 'text-xs text-gray-400' }, formatDate(msg.scheduled_at))
                                                  ),
                                      C('div', { className: 'flex gap-2 flex-shrink-0' },
                                                    msg.status === 'pending' ? C('button', { onClick: () => handleCancel(msg.id), className: 'px-3 py-1.5 text-xs font-medium rounded-lg border border-orange-200 text-orange-700 hover:bg-orange-50 transition-colors' }, 'Cancel') : null,
                                                    C('button', { onClick: () => handleDelete(msg.id), className: 'px-3 py-1.5 text-xs font-medium rounded-lg border border-red-200 text-red-700 hover:bg-red-50 transition-colors' }, 'Delete')
                                                  )
                                    )
                        )
                                                                        ))
  }

  return C('div', { className: 'min-h-screen bg-gray-50' },
               C('header', { className: 'bg-white border-b border-gray-200 sticky top-0 z-10' },
                       C('div', { className: 'max-w-5xl mx-auto px-4 h-16 flex items-center justify-between' },
                                 C('h1', { className: 'text-xl font-bold text-gray-900' }, 'SchedWhats'),
                                 C('div', { className: 'flex items-center gap-3' },
                                             userPhone ? C('span', { className: 'text-xs text-gray-400' }, userPhone) : null,
                                             C('span', { className: 'px-3 py-1.5 rounded-full text-sm font-medium border ' + (colors[status] || '') }, status)
                                           )
                               )
                     ),
               C('main', { className: 'max-w-5xl mx-auto px-4 py-8' },
                       renderSubscriptionBanner(),
                       renderPhoneInput(),
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
                                                                                   C('button', { onClick: handleGetCode, disabled: isLoading, className: 'w-full h-14 text-lg font-semibold rounded-2xl bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 transition-colors' }, isLoading ? 'Generating...' : qrCode ? 'Refresh QR Code' : 'Get Code')
                                                                                 )
                                                         ),
                                             C('div', { className: 'mt-6 bg-white rounded-3xl shadow-sm border border-gray-100 p-6' },
                                                           C('h3', { className: 'font-semibold text-gray-900 mb-3' }, 'How it works'),
                                                           C('p', { className: 'text-sm text-gray-500' }, '1. Click Get Code  2. Scan QR  3. Send vCard+date to Note to Self  4. We schedule it!')
                                                         )
                                           ),
                                 C('div', { className: 'lg:col-span-2' },
                                             C('div', { className: 'flex items-center justify-between mb-6' },
                                                           C('h2', { className: 'text-xl font-semibold text-gray-900' }, 'Scheduled Messages'),
                                                           C('span', { className: 'text-xs text-gray-400' }, messages.length + ' message' + (messages.length !== 1 ? 's' : ''))
                                                         ),
                                             renderMessages()
                                           )
                               )
                     )
             )
}
