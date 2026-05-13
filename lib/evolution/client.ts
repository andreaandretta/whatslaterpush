// @ts-nocheck
/**
 * Evolution API v2 Client
 * Handles WhatsApp instance management and messaging
 */

import { EvolutionInstance, EvolutionMessage, ConnectResponse } from '@/types'

const EVOLUTION_API_URL = process.env.EVOLUTION_API_URL
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY

if (!EVOLUTION_API_URL || !EVOLUTION_API_KEY) {
  console.warn('Evolution API credentials not configured')
}

class EvolutionClient {
  private baseUrl: string
  private apiKey: string

  constructor() {
    this.baseUrl = process.env.EVOLUTION_API_URL || ''
    this.apiKey = process.env.EVOLUTION_API_KEY || ''
  }

  /**
   * Make authenticated request to Evolution API
   */
  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`
    
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'apikey': this.apiKey,
      ...((options.headers as Record<string, string>) || {}),
    }

    const response = await fetch(url, {
      ...options,
      headers,
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Evolution API error: ${response.status} - ${error}`)
    }

    // Handle empty responses
    const contentType = response.headers.get('content-type')
    if (contentType?.includes('application/json')) {
      return response.json() as Promise<T>
    }
    
    return {} as T
  }

  /**
   * Create a new WhatsApp instance
   */
  async createInstance(instanceName: string): Promise<EvolutionInstance> {
    return this.request('/instance/create', {
      method: 'POST',
      body: JSON.stringify({
        instanceName,
        qrcode: true,
        number: '',
        integration: 'WHATSAPP-BAILEYS',
        token: '',
      }),
    })
  }

  /**
   * Get pairing code for phone number connection
   */
  async getPairingCode(
    instanceName: string,
    phoneNumber: string
  ): Promise<{ pairingCode: string; code: string }> {
    // Remove non-digits and ensure proper format
    const cleanNumber = phoneNumber.replace(/\D/g, '')
    
    return this.request('/instance/connect', {
      method: 'POST',
      body: JSON.stringify({
        instanceName,
        number: cleanNumber,
      }),
    })
  }

  /**
   * Get instance connection state
   */
  async getInstanceState(instanceName: string): Promise<{
    instance: {
      instanceName: string
      state: string
      status: string
    }
  }> {
    return this.request(`/instance/connectionState/${instanceName}`, {
      method: 'GET',
    })
  }

  /**
   * Send a text message
   */
  async sendMessage(
    instanceName: string,
    message: EvolutionMessage
  ): Promise<{
    key: {
      remoteJid: string
      fromMe: boolean
      id: string
    }
    message: unknown
    messageTimestamp: number
    status: string
  }> {
    const number = message.number.replace(/\D/g, '')
    const jid = `${number}@s.whatsapp.net`

    return this.request(`/message/sendText/${instanceName}`, {
      method: 'POST',
      body: JSON.stringify({
        number: jid,
        text: message.text,
        options: {
          delay: message.options?.delay || 1200,
          presence: message.options?.presence || 'composing',
          ...message.options,
        },
      }),
    })
  }

  /**
   * Send message to self (Note to Self)
   */
  async sendNoteToSelf(
    instanceName: string,
    text: string
  ): Promise<ReturnType<typeof this.sendMessage>> {
    // Get instance info to find own number
    const state = await this.getInstanceState(instanceName)
    
    // Note to Self uses the user's own JID
    return this.request(`/message/sendText/${instanceName}`, {
      method: 'POST',
      body: JSON.stringify({
        number: 'me',
        text,
        options: {
          delay: 1200,
          presence: 'composing',
        },
      }),
    })
  }

  /**
   * Logout and delete instance
   */
  async deleteInstance(instanceName: string): Promise<void> {
    await this.request(`/instance/logout/${instanceName}`, {
      method: 'DELETE',
    })
  }

  /**
   * Set webhook URL for instance
   */
  async setWebhook(
    instanceName: string,
    webhookUrl: string,
    events: string[] = ['MESSAGES_UPSERT']
  ): Promise<void> {
    await this.request(`/webhook/set/${instanceName}`, {
      method: 'POST',
      body: JSON.stringify({
        url: webhookUrl,
        webhook_by_events: false,
        webhook_base64: false,
        events,
      }),
    })
  }

  /**
   * Get QR Code for connection
   */
  async getQRCode(instanceName: string): Promise<{ qrcode: string; code: string }> {
    return this.request(`/instance/connect/${instanceName}`, {
      method: 'GET',
    })
  }

  /**
   * Fetch all contacts known to this WhatsApp instance.
   * Returns Evolution's raw contact objects (caller is responsible for filtering/mapping).
   */
  async findContacts(instanceName: string): Promise<Array<{
    remoteJid?: string
    pushName?: string | null
    name?: string | null
    profilePicUrl?: string | null
  }>> {
    return this.request(`/chat/findContacts/${instanceName}`, {
      method: 'POST',
      body: JSON.stringify({ where: {} }),
    })
  }

  /**
   * Fetch all chats known to this WhatsApp instance. Used as a fallback source
   * of "people the user has talked to" when findContacts returns very few rows
   * (Baileys only populates the Contact table from incoming events, not from
   * the phone's address book).
   */
  async findChats(instanceName: string): Promise<Array<{
    remoteJid?: string
    pushName?: string | null
    name?: string | null
    labelName?: string | null
    profilePicUrl?: string | null
  }>> {
    return this.request(`/chat/findChats/${instanceName}`, {
      method: 'POST',
      body: JSON.stringify({ where: {} }),
    })
  }

  /**
   * Batch-check which numbers are on WhatsApp and pull back whatever
   * name/pushName the server has cached for them. Used to enrich contacts
   * we discovered only through group membership (those have no name).
   */
  async whatsappNumbers(
    instanceName: string,
    numbers: string[]
  ): Promise<Array<{
    exists?: boolean
    jid?: string
    number?: string
    name?: string | null
    pushName?: string | null
    verifiedName?: string | null
  }>> {
    return this.request(`/chat/whatsappNumbers/${instanceName}`, {
      method: 'POST',
      body: JSON.stringify({ numbers }),
      // Evolution can be slow on large batches — bound it so /api/contacts
      // never hangs longer than ~10s on this enrichment step.
      signal: AbortSignal.timeout(10000),
    })
  }

  /**
   * Fetch all groups the instance participates in. When `getParticipants` is
   * true the response includes a `participants` array per group, which is a
   * useful supplementary source of personal contacts (Baileys' Contact table
   * misses people the user only knows through a shared group).
   */
  async fetchAllGroups(
    instanceName: string,
    getParticipants: boolean = false
  ): Promise<Array<{
    id?: string
    subject?: string | null
    participants?: Array<{ id?: string; admin?: string | null }>
  }>> {
    const qs = getParticipants ? '?getParticipants=true' : ''
    return this.request(`/group/fetchAllGroups/${instanceName}${qs}`, {
      method: 'GET',
    })
  }
}

// Export singleton instance
export const evolutionClient = new EvolutionClient()

// Export orchestration function for connection flow
export async function orchestrateConnection(
  instanceName: string,
  phoneNumber?: string
): Promise<ConnectResponse> {
  // Step 1: Create instance
  const instance = await evolutionClient.createInstance(instanceName)

  // Step 2: If phone number provided, get pairing code
  if (phoneNumber) {
    try {
      const pairingResult = await evolutionClient.getPairingCode(
        instanceName,
        phoneNumber
      )

      return {
        instanceName,
        pairingCode: pairingResult.pairingCode || pairingResult.code,
        status: 'connecting',
      }
    } catch (error) {
      console.error('Pairing code error:', error)
      // Fall back to QR code
    }
  }

  // Step 3: Get QR code as fallback
  try {
    const qrResult = await evolutionClient.getQRCode(instanceName)
    return {
      instanceName,
      qrCode: qrResult.qrcode,
      status: 'awaiting_qr',
    }
  } catch (error) {
    console.error('QR code error:', error)
    return {
      instanceName,
      status: 'created',
    }
  }
}
