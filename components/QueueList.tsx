'use client'

import { ScheduledMessage } from '@/types'
import { formatRelativeTime, truncateText } from '@/lib/utils'
import { StatusBadge } from './StatusBadge'
import { Clock, User, MessageSquare, X } from 'lucide-react'

interface QueueListProps {
  messages: ScheduledMessage[]
  onCancel?: (id: string) => Promise<void>
  isLoading?: boolean
}

export function QueueList({ messages, onCancel, isLoading }: QueueListProps) {
  if (isLoading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="bg-surface rounded-2xl p-6 shadow-card animate-pulse"
          >
            <div className="h-4 bg-border-soft rounded w-1/3 mb-4" />
            <div className="h-3 bg-border-soft rounded w-2/3" />
          </div>
        ))}
      </div>
    )
  }

  if (messages.length === 0) {
    return (
      <div className="bg-surface rounded-3xl shadow-soft p-12 text-center">
        <div className="w-24 h-24 mx-auto mb-6 rounded-full bg-background flex items-center justify-center">
          <MessageSquare className="w-12 h-12 text-text-secondary/50" />
        </div>
        <h3 className="text-xl font-semibold text-text-primary mb-2">
          No messages yet
        </h3>
        <p className="text-text-secondary max-w-md mx-auto">
          Send a contact card with a caption like "Tomorrow at 9am" in your 
          WhatsApp Note to Self to schedule your first message
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {messages.map((message, index) => (
        <div
          key={message.id}
          className="bg-surface rounded-2xl p-6 shadow-card hover:shadow-soft transition-shadow duration-200 animate-slide-up"
          style={{ animationDelay: `${index * 50}ms` }}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 mb-3">
                <div className="flex items-center gap-2 text-text-primary">
                  <User className="w-4 h-4 text-text-secondary" />
                  <span className="font-medium">
                    {message.recipient_name || 'Unknown Contact'}
                  </span>
                </div>
                <StatusBadge status={message.status} />
              </div>

              <p className="text-text-primary mb-3">
                {truncateText(message.parsed_message || message.caption, 120)}
              </p>

              <div className="flex items-center gap-4 text-sm text-text-secondary">
                <div className="flex items-center gap-1.5">
                  <Clock className="w-4 h-4" />
                  <span>{formatRelativeTime(message.scheduled_at)}</span>
                </div>
                {message.jitter_minutes > 0 && (
                  <span className="text-xs bg-background px-2 py-0.5 rounded-full">
                    +{message.jitter_minutes}min jitter
                  </span>
                )}
              </div>
            </div>

            {message.status === 'pending' && onCancel && (
              <button
                onClick={() => onCancel(message.id)}
                className="p-2 rounded-xl text-text-secondary hover:text-error-dark hover:bg-error-light transition-colors"
                title="Cancel message"
              >
                <X className="w-5 h-5" />
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
