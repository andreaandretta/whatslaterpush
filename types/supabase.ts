export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string
          email: string
          full_name: string | null
          avatar_url: string | null
          phone_number: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          email: string
          full_name?: string | null
          avatar_url?: string | null
          phone_number?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          email?: string
          full_name?: string | null
          avatar_url?: string | null
          phone_number?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_id_fkey"
            columns: ["id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      }
      whatsapp_instances: {
        Row: {
          id: string
          user_id: string
          instance_name: string
          evolution_instance_id: string | null
          status: string
          pairing_code: string | null
          qr_code: string | null
          phone_number: string | null
          profile_picture: string | null
          connected_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          instance_name: string
          evolution_instance_id?: string | null
          status?: string
          pairing_code?: string | null
          qr_code?: string | null
          phone_number?: string | null
          profile_picture?: string | null
          connected_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          instance_name?: string
          evolution_instance_id?: string | null
          status?: string
          pairing_code?: string | null
          qr_code?: string | null
          phone_number?: string | null
          profile_picture?: string | null
          connected_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_instances_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          }
        ]
      }
      scheduled_messages: {
        Row: {
          id: string
          user_id: string
          instance_id: string | null
          recipient_number: string
          recipient_name: string | null
          source_vcard: string | null
          caption: string
          parsed_message: string | null
          scheduled_at: string
          timezone: string
          jitter_minutes: number
          status: string
          sent_at: string | null
          retry_count: number
          max_retries: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          instance_id?: string | null
          recipient_number: string
          recipient_name?: string | null
          source_vcard?: string | null
          caption: string
          parsed_message?: string | null
          scheduled_at: string
          timezone?: string
          jitter_minutes?: number
          status?: string
          sent_at?: string | null
          retry_count?: number
          max_retries?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          instance_id?: string | null
          recipient_number?: string
          recipient_name?: string | null
          source_vcard?: string | null
          caption?: string
          parsed_message?: string | null
          scheduled_at?: string
          timezone?: string
          jitter_minutes?: number
          status?: string
          sent_at?: string | null
          retry_count?: number
          max_retries?: number
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "scheduled_messages_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduled_messages_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          }
        ]
      }
      message_logs: {
        Row: {
          id: string
          message_id: string | null
          user_id: string
          log_type: string
          details: Json
          error_message: string | null
          created_at: string
        }
        Insert: {
          id?: string
          message_id?: string | null
          user_id: string
          log_type: string
          details?: Json
          error_message?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          message_id?: string | null
          user_id?: string
          log_type?: string
          details?: Json
          error_message?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_logs_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "scheduled_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          }
        ]
      }
      system_status: {
        Row: {
          id: number
          status: string
          message: string | null
          updated_at: string
        }
        Insert: {
          id?: number
          status?: string
          message?: string | null
          updated_at?: string
        }
        Update: {
          id?: number
          status?: string
          message?: string | null
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}
