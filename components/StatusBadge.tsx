'use client'

import { cn } from '@/lib/utils'

interface StatusBadgeProps {
  status: string
  className?: string
}

const statusConfig: Record<string, { bg: string; text: string; label: string }> = {
  pending: {
    bg: 'bg-warning-light',
    text: 'text-warning-dark',
    label: 'Pending',
  },
  processing: {
    bg: 'bg-blue-100',
    text: 'text-blue-700',
    label: 'Processing',
  },
  sent: {
    bg: 'bg-success-light',
    text: 'text-success-dark',
    label: 'Sent',
  },
  failed: {
    bg: 'bg-error-light',
    text: 'text-error-dark',
    label: 'Failed',
  },
  cancelled: {
    bg: 'bg-gray-100',
    text: 'text-gray-600',
    label: 'Cancelled',
  },
  connected: {
    bg: 'bg-success-light',
    text: 'text-success-dark',
    label: 'Connected',
  },
  disconnected: {
    bg: 'bg-gray-100',
    text: 'text-gray-600',
    label: 'Disconnected',
  },
  connecting: {
    bg: 'bg-blue-100',
    text: 'text-blue-700',
    label: 'Connecting',
  },
  awaiting_qr: {
    bg: 'bg-warning-light',
    text: 'text-warning-dark',
    label: 'Awaiting QR',
  },
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const config = statusConfig[status.toLowerCase()] || {
    bg: 'bg-gray-100',
    text: 'text-gray-600',
    label: status,
  }

  return (
    <span
      className={cn(
        'inline-flex items-center px-3 py-1 rounded-full text-xs font-medium',
        config.bg,
        config.text,
        className
      )}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-current mr-2 animate-pulse" />
      {config.label}
    </span>
  )
}
