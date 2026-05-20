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

// Parsed Date Result (returned by lib/openai/parser)
export interface ParsedDateResult {
  scheduledAt: Date
  messageText: string
  confidence: number
  timezone: string
}

// Connect API response shape
export interface ConnectResponse {
  instanceName: string
  pairingCode?: string
  qrCode?: string
  status: string
}
