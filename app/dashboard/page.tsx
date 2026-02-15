// @ts-nocheck
'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { Smartphone, Loader2, CheckCircle2, RefreshCw, Calendar, QrCode, Wifi, WifiOff, LogOut, User } from 'lucide-react'

export default function DashboardPage() {
    const [status, setStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected')
    const [qrCode, setQrCode] = useState<string | null>(null)
    const [pairingCode, setPairingCode] = useState<string | null>(null)
    const [instanceName, setInstanceName] = useState<string>('SchedWhats-Primary')
    const [isLoading, setIsLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const refreshTimer = useRef<NodeJS.Timeout | null>(null)

  // Check connection status on mount
  useEffect(() => {
        checkStatus()
        return () => {
                if (refreshTimer.current) clearInterval(refreshTimer.current)
        }
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
                          const state = result.data?.status?.toLowerCase() || 'unknown'
                          if (state === 'open' || state === 'connected') {
                                      setStatus('connected')
                                      setQrCode(null)
                                      setPairingCode(null)
                                      if (refreshTimer.current) clearInterval(refreshTimer.current)
                          } else if (state === 'connecting' || state === 'close') {
                                      setStatus('connecting')
                          }
                }
        } catch (err) {
                // Instance might not exist yet
        }
  }

  const handleGetCode = async () => {
        setIsLoading(true)
        setError(null)
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
                                      setQrCode(qr.startsWith('data:') ? qr : `data:image/png;base64,${qr}`)
                          }
                          if (result.data.pairingCode) {
                                      setPairingCode(result.data.pairingCode)
                          }
                          // Auto-refresh QR code every 20 seconds
                  if (refreshTimer.current) clearInterval(refreshTimer.current)
                          refreshTimer.current = setInterval(async () => {
                                      try {
                                                    // First check if connected
                                        const statusRes = await fetch('/api/connect', {
                                                        method: 'POST',
                                                        headers: { 'Content-Type': 'application/json' },
                                                        body: JSON.stringify({ action: 'status', instanceName }),
                                        })
                                                    const statusResult = await statusRes.json()
                                                    const state = statusResult.data?.status?.toLowerCase() || ''
                                                    if (state === 'open' || state === 'connected') {
                                                                    setStatus('connected')
                                                                    setQrCode(null)
                                                                    setPairingCode(null)
                                                                    if (refreshTimer.current) clearInterval(refreshTimer.current)
                                                                    return
                                                    }
                                                    // Refresh QR code
                                        const refreshRes = await fetch('/api/connect', {
                                                        method: 'POST',
                                                        headers: { 'Content-Type': 'application/json' },
                                                        body: JSON.stringify({ action: 'getCode', instanceName }),
                                        })
                                                    const refreshResult = await refreshRes.json()
                                                    if (refreshResult.success && refreshResult.data?.qrCode) {
                                                                    const qr = refreshResult.data.qrCode
                                                                    setQrCode(qr.startsWith('data:') ? qr : `data:image/png;base64,${qr}`)
                                                    }
                                      } catch (e) {}
                          }, 20000)
                } else {
                          setError(result.error || 'Failed to get QR code')
                }
        } catch (err) {
                setError('Connection failed. Check Evolution API.')
        } finally {
                setIsLoading(false)
        }
  }

  const handleDisconnect = async () => {
        try {
                await fetch('/api/connect', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ action: 'disconnect', instanceName }),
                })
                setStatus('disconnected')
                setQrCode(null)
                setPairingCode(null)
                if (refreshTimer.current) clearInterval(refreshTimer.current)
        } catch (err) {}
  }

  const statusColor = {
        disconnected: 'bg-red-100 text-red-700 border-red-200',
        connecting: 'bg-orange-100 text-orange-700 border-orange-200',
        connected: 'bg-green-100 text-green-700 border-green-200',
  }

  const statusIcon = {
        disconnected: <WifiOff className="w-4 h-4" />,
        connecting: <Loader2 className="w-4 h-4 animate-spin" />,
        connected: <CheckCircle2 className="w-4 h-4" />,
  }

  return (
        <div className="min-h-screen bg-gray-50">
          {/* Header */}
              <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
                      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                            <div className="w-10 h-10 rounded-xl bg-green-600 flex items-center justify-center">
                                                          <Calendar className="w-5 h-5 text-white" />
                                            </div>div>
                                            <h1 className="text-xl font-bold text-gray-900">SchedWhats</h1>h1>
                                </div>div>
                                <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-sm font-medium ${statusColor[status]}`}>
                                  {statusIcon[status]}
                                            <span className="capitalize">{status}</span>span>
                                </div>div>
                      </div>div>
              </header>header>
        
          {/* Main Content */}
              <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
                      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                        {/* Left Column - Connect Card */}
                                <div className="lg:col-span-1">
                                            <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-8">
                                                          <div className="flex items-center gap-4 mb-6">
                                                                          <div className="w-14 h-14 rounded-2xl bg-green-50 flex items-center justify-center">
                                                                                            <Smartphone className="w-7 h-7 text-green-600" />
                                                                          </div>div>
                                                                          <div>
                                                                                            <h2 className="text-xl font-semibold text-gray-900">Connect WhatsApp</h2>h2>
                                                                                            <p className="text-sm text-gray-500 mt-1">Scan QR to link your number</p>p>
                                                                          </div>div>
                                                          </div>div>
                                            
                                              {status === 'connected' ? (
                          <div className="text-center py-8">
                                            <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-green-50 flex items-center justify-center">
                                                                <CheckCircle2 className="w-10 h-10 text-green-600" />
                                            </div>div>
                                            <h3 className="text-lg font-semibold text-green-700 mb-2">WhatsApp Connected!</h3>h3>
                                            <p className="text-gray-500 mb-4">Your WhatsApp is ready</p>p>
                                            <button onClick={handleDisconnect} className="px-4 py-2 text-sm border border-gray-300 rounded-xl hover:bg-gray-50 transition-colors">
                                                                Disconnect
                                            </button>button>
                          </div>div>
                        ) : (
                          <div className="space-y-5">
                            {qrCode && (
                                                <div className="bg-white border-2 border-green-100 rounded-2xl p-6 text-center">
                                                                      <p className="text-sm text-gray-500 mb-4">Scan with WhatsApp</p>p>
                                                                      <img src={qrCode} alt="WhatsApp QR Code" className="w-56 h-56 mx-auto rounded-xl border border-gray-100" />
                                                                      <p className="text-xs text-gray-400 mt-4">
                                                                                              WhatsApp &rarr; Settings &rarr; Linked Devices &rarr; Link a Device
                                                                      </p>p>
                                                                      <p className="text-xs text-green-600 mt-2 animate-pulse">Auto-refreshing every 20s...</p>p>
                                                </div>div>
                                            )}
                          
                            {pairingCode && (
                                                <div className="bg-green-50 border border-green-200 rounded-2xl p-6 text-center">
                                                                      <p className="text-sm text-gray-600 mb-3">Or use pairing code</p>p>
                                                                      <div className="text-3xl font-bold text-green-700 tracking-[0.4em] font-mono">
                                                                        {pairingCode}
                                                                      </div>div>
                                                </div>div>
                                            )}
                          
                            {error && (
                                                <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-center">
                                                                      <p className="text-sm text-red-600">{error}</p>p>
                                                </div>div>
                                            )}
                          
                                            <button
                                                                  onClick={handleGetCode}
                                                                  disabled={isLoading}
                                                                  className="w-full h-14 text-lg font-semibold rounded-2xl bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-3"
                                                                >
                                              {isLoading ? (
                                                                                        <>
                                                                                                                <Loader2 className="w-5 h-5 animate-spin" />
                                                                                                                Generating...
                                                                                          </>>
                                                                                      ) : qrCode ? (
                                                                                        <>
                                                                                                                <RefreshCw className="w-5 h-5" />
                                                                                                                Refresh QR Code
                                                                                          </>>
                                                                                      ) : (
                                                                                        <>
                                                                                                                <QrCode className="w-5 h-5" />
                                                                                                                Get Code
                                                                                          </>>
                                                                                      )}
                                            </button>button>
                          </div>div>
                                                          )}
                                            </div>div>
                                
                                  {/* Quick Help */}
                                            <div className="mt-6 bg-white rounded-3xl shadow-sm border border-gray-100 p-6">
                                                          <h3 className="font-semibold text-gray-900 mb-3">How it works</h3>h3>
                                                          <ol className="space-y-2 text-sm text-gray-500">
                                                                          <li className="flex gap-2"><span className="font-medium text-green-600">1.</span>span> Click "Get Code" above</li>li>
                                                                          <li className="flex gap-2"><span className="font-medium text-green-600">2.</span>span> Scan QR with WhatsApp</li>li>
                                                                          <li className="flex gap-2"><span className="font-medium text-green-600">3.</span>span> Send vCard + date to Note to Self</li>li>
                                                                          <li className="flex gap-2"><span className="font-medium text-green-600">4.</span>span> We schedule the message!</li>li>
                                                          </ol>ol>
                                            </div>div>
                                </div>div>
                      
                        {/* Right Column - Info */}
                                <div className="lg:col-span-2">
                                            <div className="flex items-center justify-between mb-6">
                                                          <h2 className="text-xl font-semibold text-gray-900">Scheduled Messages</h2>h2>
                                                          <button onClick={checkStatus} className="p-2 rounded-xl text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors">
                                                                          <RefreshCw className="w-5 h-5" />
                                                          </button>button>
                                            </div>div>
                                
                                  {status !== 'connected' ? (
                        <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-12 text-center">
                                        <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gray-100 flex items-center justify-center">
                                                          <Smartphone className="w-8 h-8 text-gray-400" />
                                        </div>div>
                                        <h3 className="text-lg font-semibold text-gray-700 mb-2">Connect WhatsApp First</h3>h3>
                                        <p className="text-gray-500">Click "Get Code" and scan the QR code to start scheduling messages.</p>p>
                        </div>div>
                      ) : (
                        <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-12 text-center">
                                        <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-green-50 flex items-center justify-center">
                                                          <CheckCircle2 className="w-8 h-8 text-green-600" />
                                        </div>div>
                                        <h3 className="text-lg font-semibold text-green-700 mb-2">WhatsApp Connected!</h3>h3>
                                        <p className="text-gray-500">Send a vCard with a date caption to your "Note to Self" chat to schedule messages.</p>p>
                        </div>div>
                                            )}
                                </div>div>
                      </div>div>
              </main>main>
        </div>div>
      )
}</></></></div>
