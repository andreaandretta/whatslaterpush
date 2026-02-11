import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * Merge Tailwind classes with proper precedence
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Format phone number to international format
 */
export function formatPhoneNumber(phone: string): string {
  // Remove all non-numeric characters
  const cleaned = phone.replace(/\D/g, '')
  
  // If starts with 0, assume it's a local number and add country code
  if (cleaned.startsWith('0')) {
    return `55${cleaned.slice(1)}` // Default to Brazil (55), adjust as needed
  }
  
  // If already has country code (10+ digits starting with valid code)
  if (cleaned.length >= 10) {
    return cleaned
  }
  
  return cleaned
}

/**
 * Format date to human readable string
 */
export function formatDate(date: Date | string): string {
  const d = new Date(date)
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d)
}

/**
 * Format relative time (e.g., "in 2 hours", "tomorrow")
 */
export function formatRelativeTime(date: Date | string): string {
  const d = new Date(date)
  const now = new Date()
  const diffMs = d.getTime() - now.getTime()
  const diffMins = Math.round(diffMs / 60000)
  const diffHours = Math.round(diffMs / 3600000)
  const diffDays = Math.round(diffMs / 86400000)

  if (diffMins < 0) return 'Overdue'
  if (diffMins < 60) return `in ${diffMins} min`
  if (diffHours < 24) return `in ${diffHours} hours`
  if (diffDays === 1) return 'Tomorrow'
  if (diffDays < 7) return `in ${diffDays} days`
  
  return formatDate(d)
}

/**
 * Generate a random jitter in minutes (0-10)
 */
export function generateJitter(): number {
  return Math.floor(Math.random() * 11)
}

/**
 * Sanitize message text
 */
export function sanitizeMessage(text: string): string {
  return text.trim().replace(/[<>]/g, '')
}

/**
 * Extract phone number from vCard string
 */
export function extractPhoneFromVCard(vcardData: string): string | null {
  // Look for TEL field in vCard
  const telMatch = vcardData.match(/TEL[;TYPE=[^:]*]?[:;]([^\n\r]+)/i)
  if (telMatch) {
    return formatPhoneNumber(telMatch[1].trim())
  }
  return null
}

/**
 * Safe JSON parse with fallback
 */
export function safeJsonParse<T>(json: string, fallback: T): T {
  try {
    return JSON.parse(json) as T
  } catch {
    return fallback
  }
}

/**
 * Debounce function
 */
export function debounce<T extends (...args: unknown[]) => unknown>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout>
  return (...args: Parameters<T>) => {
    clearTimeout(timeoutId)
    timeoutId = setTimeout(() => fn(...args), delay)
  }
}

/**
 * Check if date is in the future
 */
export function isFutureDate(date: Date | string): boolean {
  return new Date(date).getTime() > Date.now()
}

/**
 * Truncate text with ellipsis
 */
export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text
  return `${text.slice(0, maxLength)}...`
}
