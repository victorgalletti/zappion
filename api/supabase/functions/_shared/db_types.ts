export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      agents: {
        Row: {
          created_at: string
          deleted_at: string | null
          extra: Json | null
          id: string
          name: string
          organization_id: string
          picture: string | null
          role: Database["public"]["Enums"]["role"]
          updated_at: string
          user_id: string | null
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          deleted_at?: string | null
          extra?: Json | null
          id?: string
          name: string
          organization_id: string
          picture?: string | null
          role?: Database["public"]["Enums"]["role"]
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          extra?: Json | null
          id?: string
          name?: string
          organization_id?: string
          picture?: string | null
          role?: Database["public"]["Enums"]["role"]
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agents_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      api_keys: {
        Row: {
          allowed_addresses: string[] | null
          created_at: string
          created_by: string | null
          expires_at: string | null
          id: string
          key_hash: string
          key_prefix: string
          last_used_at: string | null
          name: string
          organization_id: string
          requires_approval: boolean
          revoked_at: string | null
          role: Database["public"]["Enums"]["role"]
          scope: Database["public"]["Enums"]["zappion_api_key_scope"]
          send_limit_per_hour: number
          template_limit_per_hour: number
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          allowed_addresses?: string[] | null
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          key_hash: string
          key_prefix: string
          last_used_at?: string | null
          name: string
          organization_id: string
          requires_approval?: boolean
          revoked_at?: string | null
          role?: Database["public"]["Enums"]["role"]
          scope?: Database["public"]["Enums"]["zappion_api_key_scope"]
          send_limit_per_hour?: number
          template_limit_per_hour?: number
          updated_at?: string
        }
        Update: {
          allowed_addresses?: string[] | null
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          key_hash?: string
          key_prefix?: string
          last_used_at?: string | null
          name?: string
          organization_id?: string
          requires_approval?: boolean
          revoked_at?: string | null
          role?: Database["public"]["Enums"]["role"]
          scope?: Database["public"]["Enums"]["zappion_api_key_scope"]
          send_limit_per_hour?: number
          template_limit_per_hour?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "api_keys_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "api_keys_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      contacts_addresses: {
        Row: {
          address: string
          created_at: string
          extra: Json | null
          organization_address: string
          organization_id: string
          service: Database["public"]["Enums"]["service"]
          status: string
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          address: string
          created_at?: string
          extra?: Json | null
          organization_address: string
          organization_id: string
          service: Database["public"]["Enums"]["service"]
          status?: string
          updated_at?: string
        }
        Update: {
          address?: string
          created_at?: string
          extra?: Json | null
          organization_address?: string
          organization_id?: string
          service?: Database["public"]["Enums"]["service"]
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "contacts_addresses_organization_address_fkey"
            columns: ["organization_id", "service", "organization_address"]
            isOneToOne: false
            referencedRelation: "organizations_addresses"
            referencedColumns: ["organization_id", "service", "address"]
          },
          {
            foreignKeyName: "contacts_addresses_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_preferences: {
        Row: {
          agent_id: string
          archived_at: string | null
          conversation_id: string
          created_at: string
          organization_id: string
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          agent_id: string
          archived_at?: string | null
          conversation_id: string
          created_at?: string
          organization_id: string
          updated_at?: string
        }
        Update: {
          agent_id?: string
          archived_at?: string | null
          conversation_id?: string
          created_at?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_preferences_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_preferences_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_preferences_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          address: string
          created_at: string
          extra: Json | null
          id: string
          name: string | null
          organization_address: string
          organization_id: string
          service: Database["public"]["Enums"]["service"]
          type: string | null
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          address: string
          created_at?: string
          extra?: Json | null
          id?: string
          name?: string | null
          organization_address: string
          organization_id: string
          service: Database["public"]["Enums"]["service"]
          type?: string | null
          updated_at?: string
        }
        Update: {
          address?: string
          created_at?: string
          extra?: Json | null
          id?: string
          name?: string | null
          organization_address?: string
          organization_id?: string
          service?: Database["public"]["Enums"]["service"]
          type?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversations_organization_address_fkey"
            columns: ["organization_id", "service", "organization_address"]
            isOneToOne: false
            referencedRelation: "organizations_addresses"
            referencedColumns: ["organization_id", "service", "address"]
          },
          {
            foreignKeyName: "conversations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations_agents: {
        Row: {
          agent_id: string
          conversation_id: string
          created_at: string
          extra: Json | null
          organization_address: string
          organization_id: string
          service: Database["public"]["Enums"]["service"]
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          agent_id: string
          conversation_id: string
          created_at?: string
          extra?: Json | null
          organization_address: string
          organization_id: string
          service: Database["public"]["Enums"]["service"]
          updated_at?: string
        }
        Update: {
          agent_id?: string
          conversation_id?: string
          created_at?: string
          extra?: Json | null
          organization_address?: string
          organization_id?: string
          service?: Database["public"]["Enums"]["service"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversations_agents_agent_id_fkey"
            columns: ["organization_id", "agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "conversations_agents_conversation_id_fkey"
            columns: ["organization_id", "conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "conversations_agents_organization_address_fkey"
            columns: ["organization_id", "service", "organization_address"]
            isOneToOne: false
            referencedRelation: "organizations_addresses"
            referencedColumns: ["organization_id", "service", "address"]
          },
          {
            foreignKeyName: "conversations_agents_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      invitations: {
        Row: {
          created_at: string
          email: string
          id: string
          invited_by: string | null
          invited_by_email: string | null
          invited_by_name: string | null
          organization_id: string
          organization_name: string | null
          role: Database["public"]["Enums"]["role"]
          status: string
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          email: string
          id?: string
          invited_by?: string | null
          invited_by_email?: string | null
          invited_by_name?: string | null
          organization_id: string
          organization_name?: string | null
          role?: Database["public"]["Enums"]["role"]
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          invited_by?: string | null
          invited_by_email?: string | null
          invited_by_name?: string | null
          organization_id?: string
          organization_name?: string | null
          role?: Database["public"]["Enums"]["role"]
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "invitations_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invitations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      logs: {
        Row: {
          category: string
          created_at: string
          id: string
          level: Database["public"]["Enums"]["log_level"]
          message: string
          metadata: Json | null
          organization_address: string | null
          organization_id: string
          service: Database["public"]["Enums"]["service"] | null
        }
        ComputedFields: never
        Insert: {
          category: string
          created_at?: string
          id?: string
          level: Database["public"]["Enums"]["log_level"]
          message: string
          metadata?: Json | null
          organization_address?: string | null
          organization_id: string
          service?: Database["public"]["Enums"]["service"] | null
        }
        Update: {
          category?: string
          created_at?: string
          id?: string
          level?: Database["public"]["Enums"]["log_level"]
          message?: string
          metadata?: Json | null
          organization_address?: string | null
          organization_id?: string
          service?: Database["public"]["Enums"]["service"] | null
        }
        Relationships: [
          {
            foreignKeyName: "logs_organization_address_fkey"
            columns: ["organization_id", "service", "organization_address"]
            isOneToOne: false
            referencedRelation: "organizations_addresses"
            referencedColumns: ["organization_id", "service", "address"]
          },
          {
            foreignKeyName: "logs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      mcp_calls: {
        Row: {
          api_key_id: string | null
          contact_phone: string | null
          created_at: string
          error: string | null
          finished_at: string | null
          id: string
          organization_id: string
          send_kind: string | null
          status: string
          tool: string
          user_id: string | null
        }
        ComputedFields: never
        Insert: {
          api_key_id?: string | null
          contact_phone?: string | null
          created_at?: string
          error?: string | null
          finished_at?: string | null
          id?: string
          organization_id: string
          send_kind?: string | null
          status?: string
          tool: string
          user_id?: string | null
        }
        Update: {
          api_key_id?: string | null
          contact_phone?: string | null
          created_at?: string
          error?: string | null
          finished_at?: string | null
          id?: string
          organization_id?: string
          send_kind?: string | null
          status?: string
          tool?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mcp_calls_api_key_id_fkey"
            columns: ["api_key_id"]
            isOneToOne: false
            referencedRelation: "api_keys"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mcp_calls_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          agent_id: string | null
          content: NonNullable<Json>
          conversation_address: string | null
          conversation_id: string
          created_at: string
          external_id: string | null
          id: string
          organization_address: string
          organization_id: string
          sender_address: string | null
          service: Database["public"]["Enums"]["service"]
          status: NonNullable<Json>
          thread_id: string | null
          timestamp: string
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          agent_id?: string | null
          content: NonNullable<Json>
          conversation_address?: string | null
          conversation_id: string
          created_at?: string
          external_id?: string | null
          id?: string
          organization_address: string
          organization_id: string
          sender_address?: string | null
          service: Database["public"]["Enums"]["service"]
          status?: NonNullable<Json>
          thread_id?: string | null
          timestamp?: string
          updated_at?: string
        }
        Update: {
          agent_id?: string | null
          content?: NonNullable<Json>
          conversation_address?: string | null
          conversation_id?: string
          created_at?: string
          external_id?: string | null
          id?: string
          organization_address?: string
          organization_id?: string
          sender_address?: string | null
          service?: Database["public"]["Enums"]["service"]
          status?: NonNullable<Json>
          thread_id?: string | null
          timestamp?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      onboarding_tokens: {
        Row: {
          callback_url: string | null
          created_at: string
          expires_at: string
          id: string
          name: string
          organization_id: string
          service: Database["public"]["Enums"]["service"]
          status: string
          used_at: string | null
          verify_token: string | null
        }
        ComputedFields: never
        Insert: {
          callback_url?: string | null
          created_at?: string
          expires_at: string
          id?: string
          name: string
          organization_id: string
          service: Database["public"]["Enums"]["service"]
          status?: string
          used_at?: string | null
          verify_token?: string | null
        }
        Update: {
          callback_url?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          name?: string
          organization_id?: string
          service?: Database["public"]["Enums"]["service"]
          status?: string
          used_at?: string | null
          verify_token?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "onboarding_tokens_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          extra: Json | null
          id: string
          name: string
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          extra?: Json | null
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          extra?: Json | null
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      organizations_addresses: {
        Row: {
          address: string
          agent_id: string | null
          created_at: string
          extra: Json | null
          organization_id: string
          service: Database["public"]["Enums"]["service"]
          status: string
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          address: string
          agent_id?: string | null
          created_at?: string
          extra?: Json | null
          organization_id: string
          service: Database["public"]["Enums"]["service"]
          status?: string
          updated_at?: string
        }
        Update: {
          address?: string
          agent_id?: string | null
          created_at?: string
          extra?: Json | null
          organization_id?: string
          service?: Database["public"]["Enums"]["service"]
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "organizations_addresses_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organizations_addresses_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      webhooks: {
        Row: {
          created_at: string
          id: string
          operations: Database["public"]["Enums"]["webhook_operation"][]
          organization_id: string
          table_name: Database["public"]["Enums"]["webhook_table"]
          token: string | null
          updated_at: string
          url: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          id?: string
          operations: Database["public"]["Enums"]["webhook_operation"][]
          organization_id: string
          table_name: Database["public"]["Enums"]["webhook_table"]
          token?: string | null
          updated_at?: string
          url: string
        }
        Update: {
          created_at?: string
          id?: string
          operations?: Database["public"]["Enums"]["webhook_operation"][]
          organization_id?: string
          table_name?: Database["public"]["Enums"]["webhook_table"]
          token?: string | null
          updated_at?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "webhooks_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_apps: {
        Row: {
          app_id: string
          created_at: string
          organization_id: string
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          app_id: string
          created_at?: string
          organization_id: string
          updated_at?: string
        }
        Update: {
          app_id?: string
          created_at?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_apps_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      zappion_message_approvals: {
        Row: {
          api_key_id: string | null
          api_key_name: string
          conversation_id: string
          decided_at: string | null
          decided_by: string | null
          decision: string | null
          message_id: string
          organization_id: string
          requested_at: string
          send_kind: string
        }
        ComputedFields: never
        Insert: {
          api_key_id?: string | null
          api_key_name: string
          conversation_id: string
          decided_at?: string | null
          decided_by?: string | null
          decision?: string | null
          message_id: string
          organization_id: string
          requested_at?: string
          send_kind: string
        }
        Update: {
          api_key_id?: string | null
          api_key_name?: string
          conversation_id?: string
          decided_at?: string | null
          decided_by?: string | null
          decision?: string | null
          message_id?: string
          organization_id?: string
          requested_at?: string
          send_kind?: string
        }
        Relationships: [
          {
            foreignKeyName: "zappion_message_approvals_api_key_id_fkey"
            columns: ["api_key_id"]
            isOneToOne: false
            referencedRelation: "api_keys"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "zappion_message_approvals_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "zappion_message_approvals_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "zappion_message_approvals_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: true
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "zappion_message_approvals_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_invitation: { Args: { invitation_id: string }; Returns: string }
      agent_identity_and_role_unchanged: {
        Args: {
          p_id: string
          p_organization_id: string
          p_role: Database["public"]["Enums"]["role"]
          p_user_id: string
        }
        Returns: boolean
      }
      agent_identity_unchanged: {
        Args: { p_id: string; p_organization_id: string; p_user_id: string }
        Returns: boolean
      }
      get_authorized_orgs: {
        Args: { role?: Database["public"]["Enums"]["role"] }
        Returns: string[]
      }
      get_own_agents: { Args: Record<PropertyKey, never>; Returns: string[] }
      get_participant_conversations: {
        Args: Record<PropertyKey, never>
        Returns: string[]
      }
      get_restricted_conversations: {
        Args: Record<PropertyKey, never>
        Returns: string[]
      }
      get_visible_addresses: {
        Args: Record<PropertyKey, never>
        Returns: {
          address: string
          organization_id: string
          service: Database["public"]["Enums"]["service"]
        }[]
      }
      init_data: {
        Args: {
          p_limit?: number
          p_organization_id: string
          p_per_conversation?: number
          p_since?: string
          p_until?: string
        }
        Returns: Json
      }
      is_conversation_visible: {
        Args: {
          conv_addr: string
          conv_id: string
          conv_org: string
          conv_service: Database["public"]["Enums"]["service"]
        }
        Returns: boolean
      }
      is_media_visible: { Args: { object_name: string }; Returns: boolean }
      mark_read: {
        Args: { p_message_id: string; p_typing?: boolean }
        Returns: undefined
      }
      merge_update_jsonb: {
        Args: { object: Json; path: string[]; target: Json }
        Returns: Json
      }
      reject_invitation: { Args: { invitation_id: string }; Returns: undefined }
      set_address_label: {
        Args: {
          p_address: string
          p_label: string
          p_service: Database["public"]["Enums"]["service"]
        }
        Returns: undefined
      }
      whatsapp_access_token: {
        Args: { p_address: string; p_organization_id: string }
        Returns: string
      }
      whatsapp_address_token_set: {
        Args: { p_address: string; p_organization_id: string; p_token: string }
        Returns: undefined
      }
      whatsapp_app_credentials: {
        Args: { p_app_id: string }
        Returns: {
          app_id: string
          app_secret: string
          organization_id: string
          system_token: string
          verify_token: string
        }[]
      }
      whatsapp_app_delete: {
        Args: { p_organization_id: string }
        Returns: undefined
      }
      whatsapp_app_save: {
        Args: {
          p_app_id: string
          p_app_secret?: string
          p_organization_id: string
          p_system_token?: string
        }
        Returns: string
      }
      whatsapp_app_settings: {
        Args: { p_organization_id: string }
        Returns: {
          app_id: string
          has_app_secret: boolean
          has_system_token: boolean
          updated_at: string
          verify_token: string
        }[]
      }
      whatsapp_org_app_credentials: {
        Args: { p_organization_id: string }
        Returns: {
          app_id: string
          app_secret: string
          organization_id: string
          system_token: string
          verify_token: string
        }[]
      }
      zappion_api_key_refusal: {
        Args: { p_expires_at: string; p_id: string; p_revoked_at: string }
        Returns: Json
      }
      zappion_approve_message: { Args: { p_message_id: string }; Returns: Json }
      zappion_create_api_key: {
        Args: {
          p_allowed_addresses?: string[]
          p_expires_at?: string
          p_name: string
          p_organization_id: string
          p_requires_approval?: boolean
          p_scope?: Database["public"]["Enums"]["zappion_api_key_scope"]
          p_send_limit_per_hour?: number
          p_template_limit_per_hour?: number
        }
        Returns: Json
      }
      zappion_get_secret: { Args: { p_name: string }; Returns: string }
      zappion_hash_api_key: { Args: { p_key: string }; Returns: string }
      zappion_lock_approval: {
        Args: { p_message_id: string }
        Returns: {
          api_key_id: string | null
          api_key_name: string
          conversation_id: string
          decided_at: string | null
          decided_by: string | null
          decision: string | null
          message_id: string
          organization_id: string
          requested_at: string
          send_kind: string
        }
        SetofOptions: {
          from: "*"
          to: "zappion_message_approvals"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      zappion_mcp_authenticate: {
        Args: Record<PropertyKey, never>
        Returns: Json
      }
      zappion_mcp_begin_call: {
        Args: {
          p_contact_phone?: string
          p_organization_id: string
          p_scope: Database["public"]["Enums"]["zappion_api_key_scope"]
          p_send_kind?: string
          p_tool: string
        }
        Returns: Json
      }
      zappion_mcp_finish_call: {
        Args: { p_call_id: string; p_error?: string; p_ok: boolean }
        Returns: undefined
      }
      zappion_mcp_set_archived: {
        Args: {
          p_archived: boolean
          p_conversation_id: string
          p_organization_id: string
        }
        Returns: undefined
      }
      zappion_put_secret: {
        Args: { p_name: string; p_value: string }
        Returns: undefined
      }
      zappion_reject_message: { Args: { p_message_id: string }; Returns: Json }
      zappion_request_api_key: {
        Args: Record<PropertyKey, never>
        Returns: {
          allowed_addresses: string[] | null
          created_at: string
          created_by: string | null
          expires_at: string | null
          id: string
          key_hash: string
          key_prefix: string
          last_used_at: string | null
          name: string
          organization_id: string
          requires_approval: boolean
          revoked_at: string | null
          role: Database["public"]["Enums"]["role"]
          scope: Database["public"]["Enums"]["zappion_api_key_scope"]
          send_limit_per_hour: number
          template_limit_per_hour: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "api_keys"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      zappion_revoke_api_key: { Args: { p_id: string }; Returns: undefined }
    }
    Enums: {
      log_level: "info" | "warning" | "error"
      role: "owner" | "admin" | "member"
      service:
        | "whatsapp"
        | "instagram"
        | "local"
        | "slack"
        | "discord"
        | "teams"
        | "whatsapp-web"
      webhook_operation: "insert" | "update"
      webhook_table:
        | "messages"
        | "conversations"
        | "organizations_addresses"
        | "contacts_addresses"
        | "logs"
      zappion_api_key_scope: "read" | "send" | "admin"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  storage: {
    Tables: {
      buckets: {
        Row: {
          allowed_mime_types: string[] | null
          avif_autodetection: boolean | null
          created_at: string | null
          file_size_limit: number | null
          id: string
          lifecycle_configuration: Json | null
          lifecycle_configuration_generation: string | null
          name: string
          owner: string | null
          owner_id: string | null
          public: boolean | null
          type: Database["storage"]["Enums"]["buckettype"]
          updated_at: string | null
          versioning_status: string
        }
        ComputedFields: never
        Insert: {
          allowed_mime_types?: string[] | null
          avif_autodetection?: boolean | null
          created_at?: string | null
          file_size_limit?: number | null
          id: string
          lifecycle_configuration?: Json | null
          lifecycle_configuration_generation?: string | null
          name: string
          owner?: string | null
          owner_id?: string | null
          public?: boolean | null
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string | null
          versioning_status?: string
        }
        Update: {
          allowed_mime_types?: string[] | null
          avif_autodetection?: boolean | null
          created_at?: string | null
          file_size_limit?: number | null
          id?: string
          lifecycle_configuration?: Json | null
          lifecycle_configuration_generation?: string | null
          name?: string
          owner?: string | null
          owner_id?: string | null
          public?: boolean | null
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string | null
          versioning_status?: string
        }
        Relationships: []
      }
      buckets_analytics: {
        Row: {
          created_at: string
          deleted_at: string | null
          format: string
          id: string
          name: string
          type: Database["storage"]["Enums"]["buckettype"]
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          deleted_at?: string | null
          format?: string
          id?: string
          name: string
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          format?: string
          id?: string
          name?: string
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string
        }
        Relationships: []
      }
      buckets_vectors: {
        Row: {
          created_at: string
          id: string
          type: Database["storage"]["Enums"]["buckettype"]
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          id: string
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string
        }
        Relationships: []
      }
      iceberg_namespaces: {
        Row: {
          bucket_name: string
          catalog_id: string
          created_at: string
          id: string
          metadata: NonNullable<Json>
          name: string
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          bucket_name: string
          catalog_id: string
          created_at?: string
          id?: string
          metadata?: NonNullable<Json>
          name: string
          updated_at?: string
        }
        Update: {
          bucket_name?: string
          catalog_id?: string
          created_at?: string
          id?: string
          metadata?: NonNullable<Json>
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "iceberg_namespaces_catalog_id_fkey"
            columns: ["catalog_id"]
            isOneToOne: false
            referencedRelation: "buckets_analytics"
            referencedColumns: ["id"]
          },
        ]
      }
      iceberg_tables: {
        Row: {
          bucket_name: string
          catalog_id: string
          created_at: string
          id: string
          location: string
          name: string
          namespace_id: string
          remote_table_id: string | null
          shard_id: string | null
          shard_key: string | null
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          bucket_name: string
          catalog_id: string
          created_at?: string
          id?: string
          location: string
          name: string
          namespace_id: string
          remote_table_id?: string | null
          shard_id?: string | null
          shard_key?: string | null
          updated_at?: string
        }
        Update: {
          bucket_name?: string
          catalog_id?: string
          created_at?: string
          id?: string
          location?: string
          name?: string
          namespace_id?: string
          remote_table_id?: string | null
          shard_id?: string | null
          shard_key?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "iceberg_tables_catalog_id_fkey"
            columns: ["catalog_id"]
            isOneToOne: false
            referencedRelation: "buckets_analytics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "iceberg_tables_namespace_id_fkey"
            columns: ["namespace_id"]
            isOneToOne: false
            referencedRelation: "iceberg_namespaces"
            referencedColumns: ["id"]
          },
        ]
      }
      migrations: {
        Row: {
          executed_at: string | null
          hash: string
          id: number
          name: string
        }
        ComputedFields: never
        Insert: {
          executed_at?: string | null
          hash: string
          id: number
          name: string
        }
        Update: {
          executed_at?: string | null
          hash?: string
          id?: number
          name?: string
        }
        Relationships: []
      }
      objects: {
        Row: {
          archived_at: string | null
          bucket_id: string | null
          created_at: string | null
          id: string
          is_delete_marker: boolean
          is_versioned: boolean
          last_accessed_at: string | null
          metadata: Json | null
          name: string | null
          owner: string | null
          owner_id: string | null
          path_tokens: string[] | null
          updated_at: string | null
          user_metadata: Json | null
          version: string | null
        }
        ComputedFields: never
        Insert: {
          archived_at?: string | null
          bucket_id?: string | null
          created_at?: string | null
          id?: string
          is_delete_marker?: boolean
          is_versioned?: boolean
          last_accessed_at?: string | null
          metadata?: Json | null
          name?: string | null
          owner?: string | null
          owner_id?: string | null
          path_tokens?: never
          updated_at?: string | null
          user_metadata?: Json | null
          version?: string | null
        }
        Update: {
          archived_at?: string | null
          bucket_id?: string | null
          created_at?: string | null
          id?: string
          is_delete_marker?: boolean
          is_versioned?: boolean
          last_accessed_at?: string | null
          metadata?: Json | null
          name?: string | null
          owner?: string | null
          owner_id?: string | null
          path_tokens?: never
          updated_at?: string | null
          user_metadata?: Json | null
          version?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "objects_bucketId_fkey"
            columns: ["bucket_id"]
            isOneToOne: false
            referencedRelation: "buckets"
            referencedColumns: ["id"]
          },
        ]
      }
      s3_multipart_uploads: {
        Row: {
          bucket_id: string
          created_at: string
          id: string
          in_progress_size: number
          key: string
          metadata: Json | null
          owner_id: string | null
          upload_signature: string
          user_metadata: Json | null
          version: string
        }
        ComputedFields: never
        Insert: {
          bucket_id: string
          created_at?: string
          id: string
          in_progress_size?: number
          key: string
          metadata?: Json | null
          owner_id?: string | null
          upload_signature: string
          user_metadata?: Json | null
          version: string
        }
        Update: {
          bucket_id?: string
          created_at?: string
          id?: string
          in_progress_size?: number
          key?: string
          metadata?: Json | null
          owner_id?: string | null
          upload_signature?: string
          user_metadata?: Json | null
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "s3_multipart_uploads_bucket_id_fkey"
            columns: ["bucket_id"]
            isOneToOne: false
            referencedRelation: "buckets"
            referencedColumns: ["id"]
          },
        ]
      }
      s3_multipart_uploads_parts: {
        Row: {
          bucket_id: string
          created_at: string
          etag: string
          id: string
          key: string
          owner_id: string | null
          part_number: number
          size: number
          upload_id: string
          version: string
        }
        ComputedFields: never
        Insert: {
          bucket_id: string
          created_at?: string
          etag: string
          id?: string
          key: string
          owner_id?: string | null
          part_number: number
          size?: number
          upload_id: string
          version: string
        }
        Update: {
          bucket_id?: string
          created_at?: string
          etag?: string
          id?: string
          key?: string
          owner_id?: string | null
          part_number?: number
          size?: number
          upload_id?: string
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "s3_multipart_uploads_parts_bucket_id_fkey"
            columns: ["bucket_id"]
            isOneToOne: false
            referencedRelation: "buckets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "s3_multipart_uploads_parts_upload_id_fkey"
            columns: ["upload_id"]
            isOneToOne: false
            referencedRelation: "s3_multipart_uploads"
            referencedColumns: ["id"]
          },
        ]
      }
      vector_indexes: {
        Row: {
          bucket_id: string
          created_at: string
          data_type: string
          dimension: number
          distance_metric: string
          id: string
          metadata_configuration: Json | null
          name: string
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          bucket_id: string
          created_at?: string
          data_type: string
          dimension: number
          distance_metric: string
          id?: string
          metadata_configuration?: Json | null
          name: string
          updated_at?: string
        }
        Update: {
          bucket_id?: string
          created_at?: string
          data_type?: string
          dimension?: number
          distance_metric?: string
          id?: string
          metadata_configuration?: Json | null
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "vector_indexes_bucket_id_fkey"
            columns: ["bucket_id"]
            isOneToOne: false
            referencedRelation: "buckets_vectors"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      allow_any_operation: {
        Args: { expected_operations: string[] }
        Returns: boolean
      }
      allow_only_operation: {
        Args: { expected_operation: string }
        Returns: boolean
      }
      can_insert_object: {
        Args: { bucketid: string; metadata: Json; name: string; owner: string }
        Returns: undefined
      }
      extension: { Args: { name: string }; Returns: string }
      filename: { Args: { name: string }; Returns: string }
      foldername: { Args: { name: string }; Returns: string[] }
      get_common_prefix: {
        Args: { p_delimiter: string; p_key: string; p_prefix: string }
        Returns: string
      }
      get_size_by_bucket: {
        Args: { delete_markers?: string; noncurrent_versions?: string }
        Returns: {
          bucket_id: string
          size: number
        }[]
      }
      list_multipart_uploads_with_delimiter: {
        Args: {
          bucket_id: string
          delimiter_param: string
          max_keys?: number
          next_key_token?: string
          next_upload_token?: string
          prefix_param: string
          raw_prefix_param?: string
        }
        Returns: {
          created_at: string
          id: string
          key: string
        }[]
      }
      list_objects_with_delimiter: {
        Args: {
          _bucket_id: string
          delete_markers?: string
          delimiter_param: string
          max_keys?: number
          next_token?: string
          next_token_archived_at?: string
          next_token_version?: string
          noncurrent_versions?: string
          prefix_param: string
          sort_order?: string
          start_after?: string
        }
        Returns: {
          archived_at: string
          created_at: string
          id: string
          is_delete_marker: boolean
          is_versioned: boolean
          last_accessed_at: string
          metadata: Json
          name: string
          updated_at: string
          version: string
        }[]
      }
      operation: { Args: Record<PropertyKey, never>; Returns: string }
      search: {
        Args: {
          bucketname: string
          delete_markers?: string
          levels?: number
          limits?: number
          noncurrent_versions?: string
          offsets?: number
          prefix: string
          search?: string
          sortcolumn?: string
          sortorder?: string
        }
        Returns: {
          archived_at: string
          created_at: string
          id: string
          is_delete_marker: boolean
          is_versioned: boolean
          last_accessed_at: string
          metadata: Json
          name: string
          updated_at: string
          version: string
        }[]
      }
      search_by_timestamp: {
        Args: {
          delete_markers?: string
          noncurrent_versions?: string
          p_bucket_id: string
          p_level: number
          p_limit: number
          p_prefix: string
          p_sort_column: string
          p_sort_column_after: string
          p_sort_order: string
          p_start_after: string
          p_start_after_version?: string
        }
        Returns: {
          archived_at: string
          created_at: string
          id: string
          is_delete_marker: boolean
          is_versioned: boolean
          key: string
          last_accessed_at: string
          metadata: Json
          name: string
          updated_at: string
          version: string
        }[]
      }
      search_v2: {
        Args: {
          bucket_name: string
          delete_markers?: string
          levels?: number
          limits?: number
          noncurrent_versions?: string
          prefix: string
          sort_column?: string
          sort_column_after?: string
          sort_order?: string
          start_after?: string
          start_after_archived_at?: string
          start_after_is_continuation?: boolean
          start_after_version?: string
        }
        Returns: {
          archived_at: string
          created_at: string
          id: string
          is_delete_marker: boolean
          is_versioned: boolean
          key: string
          last_accessed_at: string
          metadata: Json
          name: string
          updated_at: string
          version: string
        }[]
      }
    }
    Enums: {
      buckettype: "STANDARD" | "ANALYTICS" | "VECTOR"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      log_level: ["info", "warning", "error"],
      role: ["owner", "admin", "member"],
      service: [
        "whatsapp",
        "instagram",
        "local",
        "slack",
        "discord",
        "teams",
        "whatsapp-web",
      ],
      webhook_operation: ["insert", "update"],
      webhook_table: [
        "messages",
        "conversations",
        "organizations_addresses",
        "contacts_addresses",
        "logs",
      ],
      zappion_api_key_scope: ["read", "send", "admin"],
    },
  },
  storage: {
    Enums: {
      buckettype: ["STANDARD", "ANALYTICS", "VECTOR"],
    },
  },
} as const
