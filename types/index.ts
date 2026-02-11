import { Database } from './supabase'

// Supabase Table Types
export type Profile = Database['public']['Tables']['profiles']['Row']
export type WhatsappInstance = Database['public']['Tables']['whatsapp_instances']['Row']
export type ScheduledMessage = Database['public']['Tables']['scheduled_messages']['Row']
export type MessageLog = Database['public']['Tables']['message_logs']['Row']
export type SystemStatus = Database['public']['Tables']['system_status']['Row']

// Insert/Update Types
export type ProfileInsert = Database['public']['Tables']['profiles']['Insert']
export type WhatsappInstanceInsert = Database['public']['Tables']['whatsapp_instances']['Insert']
export type ScheduledMessageInsert = Database['public']['Tables']['scheduled_messages']['Insert']
export type MessageLogInsert = Database['public']['Tables']['message_logs']['Insert']

// Evolution API Types
export interface EvolutionInstance {
  instanceName: string
  instanceId?: string
  status?: string
  qrcode?: string
  pairingCode?: string
}

export interface EvolutionMessage {
  number: string
  text: string
  options?: {
    delay?: number
    presence?: 'composing' | 'recording' | 'paused'
  }
}

export interface EvolutionWebhookPayload {
  event: string
  instance: string
  data: {
    message?: {
      conversation?: string
      extendedTextMessage?: {
        text?: string
        contextInfo?: {
          quotedMessage?: {
            conversation?: string
          }
        }
      }
    }
    messageType?: string
    remoteJid?: string
    pushName?: string
    messageTimestamp?: number
    source?: string
  }
}

// Parsed Date Result
export interface ParsedDateResult {
  scheduledAt: Date
  messageText: string
  confidence: number
  timezone: string
}

// UI Component Types
export interface ConnectCardProps {
  onConnect: (phoneNumber: string) => Promise<void>
  isConnecting: boolean
  pairingCode?: string
  qrCode?: string
}

export interface QueueItemProps {
  message: ScheduledMessage
  onCancel?: (id: string) => Promise<void>
}

export interface StatusBadgeProps {
  status: string
}

// API Response Types
export interface ApiResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
  message?: string
}

export interface HealthCheckResponse {
  status: 'healthy' | 'degraded' | 'unhealthy'
  timestamp: string
  version: string
  services: {
    database: boolean
    evolution: boolean
    openai: boolean
  }
  systemStatus: string
}

export interface ConnectResponse {
  instanceName: string
  pairingCode?: string
  qrCode?: string
  status: string
}

// vCard Contact
export interface ContactInfo {
  phoneNumber: string
  displayName?: string
  email?: string
  organization?: string
}
