-- =====================================================
-- SchedWhats Database Schema v7.0
-- Modern Soft UI Edition
-- =====================================================

-- Enable necessary extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =====================================================
-- PROFILES TABLE
-- Stores user profile information linked to Supabase Auth
-- =====================================================
CREATE TABLE profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT UNIQUE NOT NULL,
    full_name TEXT,
    avatar_url TEXT,
    phone_number TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- WHATSAPP INSTANCES TABLE
-- Manages Evolution API WhatsApp connections
-- =====================================================
CREATE TABLE whatsapp_instances (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    instance_name TEXT NOT NULL,
    evolution_instance_id TEXT,
    status TEXT DEFAULT 'disconnected' CHECK (status IN ('connected', 'disconnected', 'connecting', 'error')),
    pairing_code TEXT,
    qr_code TEXT,
    phone_number TEXT,
    profile_picture TEXT,
    connected_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(user_id, instance_name)
);

-- =====================================================
-- SCHEDULED MESSAGES TABLE
-- Core table for message scheduling
-- =====================================================
CREATE TABLE scheduled_messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    instance_id UUID REFERENCES whatsapp_instances(id) ON DELETE SET NULL,
    
    -- Recipient Information
    recipient_number TEXT NOT NULL,
    recipient_name TEXT,
    source_vcard TEXT, -- Original vCard data
    
    -- Message Content
    caption TEXT NOT NULL, -- Original caption with natural language date
    parsed_message TEXT, -- Clean message after date extraction
    
    -- Scheduling
    scheduled_at TIMESTAMPTZ NOT NULL,
    timezone TEXT DEFAULT 'UTC',
    jitter_minutes INTEGER DEFAULT 0, -- Random delay added
    
    -- Status tracking
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'sent', 'failed', 'cancelled')),
    sent_at TIMESTAMPTZ,
    
    -- Retry logic
    retry_count INTEGER DEFAULT 0,
    max_retries INTEGER DEFAULT 3,
    
    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- MESSAGE LOGS TABLE
-- Audit trail for all message operations
-- =====================================================
CREATE TABLE message_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    message_id UUID REFERENCES scheduled_messages(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    
    log_type TEXT NOT NULL CHECK (log_type IN ('created', 'parsed', 'scheduled', 'sent', 'failed', 'retry', 'cancelled')),
    details JSONB DEFAULT '{}',
    error_message TEXT,
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- SYSTEM STATUS TABLE
-- For health checks and maintenance mode
-- =====================================================
CREATE TABLE system_status (
    id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'maintenance', 'degraded')),
    message TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert default system status
INSERT INTO system_status (id, status, message) VALUES (1, 'active', 'System operational') ON CONFLICT DO NOTHING;

-- =====================================================
-- INDEXES
-- =====================================================
CREATE INDEX idx_profiles_email ON profiles(email);
CREATE INDEX idx_whatsapp_instances_user_id ON whatsapp_instances(user_id);
CREATE INDEX idx_whatsapp_instances_status ON whatsapp_instances(status);
CREATE INDEX idx_scheduled_messages_user_id ON scheduled_messages(user_id);
CREATE INDEX idx_scheduled_messages_status ON scheduled_messages(status);
CREATE INDEX idx_scheduled_messages_scheduled_at ON scheduled_messages(scheduled_at);
CREATE INDEX idx_scheduled_messages_pending ON scheduled_messages(status, scheduled_at) WHERE status = 'pending';
CREATE INDEX idx_message_logs_message_id ON message_logs(message_id);
CREATE INDEX idx_message_logs_user_id ON message_logs(user_id);
CREATE INDEX idx_message_logs_created_at ON message_logs(created_at);

-- =====================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- =====================================================

-- Enable RLS on all tables
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_instances ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduled_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_status ENABLE ROW LEVEL SECURITY;

-- =====================================================
-- PROFILES POLICIES
-- =====================================================
CREATE POLICY "Users can view own profile" 
    ON profiles FOR SELECT 
    USING (auth.uid() = id);

CREATE POLICY "Users can update own profile" 
    ON profiles FOR UPDATE 
    USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile" 
    ON profiles FOR INSERT 
    WITH CHECK (auth.uid() = id);

-- =====================================================
-- WHATSAPP INSTANCES POLICIES
-- =====================================================
CREATE POLICY "Users can view own instances" 
    ON whatsapp_instances FOR SELECT 
    USING (auth.uid() = user_id);

CREATE POLICY "Users can create own instances" 
    ON whatsapp_instances FOR INSERT 
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own instances" 
    ON whatsapp_instances FOR UPDATE 
    USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own instances" 
    ON whatsapp_instances FOR DELETE 
    USING (auth.uid() = user_id);

-- =====================================================
-- SCHEDULED MESSAGES POLICIES
-- =====================================================
CREATE POLICY "Users can view own messages" 
    ON scheduled_messages FOR SELECT 
    USING (auth.uid() = user_id);

CREATE POLICY "Users can create own messages" 
    ON scheduled_messages FOR INSERT 
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own messages" 
    ON scheduled_messages FOR UPDATE 
    USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own messages" 
    ON scheduled_messages FOR DELETE 
    USING (auth.uid() = user_id);

-- =====================================================
-- MESSAGE LOGS POLICIES
-- =====================================================
CREATE POLICY "Users can view own logs" 
    ON message_logs FOR SELECT 
    USING (auth.uid() = user_id);

CREATE POLICY "Users can create own logs" 
    ON message_logs FOR INSERT 
    WITH CHECK (auth.uid() = user_id);

-- System status is publicly readable
CREATE POLICY "System status is public" 
    ON system_status FOR SELECT 
    TO PUBLIC 
    USING (true);

-- Only service role can update system status
CREATE POLICY "Only service role can update system status" 
    ON system_status FOR ALL 
    USING (false) 
    WITH CHECK (false);

-- =====================================================
-- FUNCTIONS & TRIGGERS
-- =====================================================

-- Update timestamps automatically
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply update triggers
CREATE TRIGGER update_profiles_updated_at 
    BEFORE UPDATE ON profiles 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_whatsapp_instances_updated_at 
    BEFORE UPDATE ON whatsapp_instances 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_scheduled_messages_updated_at 
    BEFORE UPDATE ON scheduled_messages 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_system_status_updated_at 
    BEFORE UPDATE ON system_status 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Function to create profile after signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (id, email, full_name)
    VALUES (NEW.id, NEW.email, NEW.raw_user_meta_data->>'full_name');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to create profile on signup
CREATE OR REPLACE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- =====================================================
-- HELPER FUNCTIONS
-- =====================================================

-- Function to get pending messages ready to send
CREATE OR REPLACE FUNCTION get_pending_messages_to_send()
RETURNS TABLE (
    id UUID,
    user_id UUID,
    instance_id UUID,
    recipient_number TEXT,
    parsed_message TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        sm.id,
        sm.user_id,
        sm.instance_id,
        sm.recipient_number,
        sm.parsed_message
    FROM scheduled_messages sm
    WHERE sm.status = 'pending'
        AND sm.scheduled_at <= NOW()
    ORDER BY sm.scheduled_at ASC
    LIMIT 50;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to log message action
CREATE OR REPLACE FUNCTION log_message_action(
    p_message_id UUID,
    p_user_id UUID,
    p_log_type TEXT,
    p_details JSONB DEFAULT '{}',
    p_error_message TEXT DEFAULT NULL
)
RETURNS VOID AS $$
BEGIN
    INSERT INTO message_logs (message_id, user_id, log_type, details, error_message)
    VALUES (p_message_id, p_user_id, p_log_type, p_details, p_error_message);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- DAILY REPORTS TABLE
-- Stores daily system + business report snapshots
-- =====================================================
CREATE TABLE daily_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    report_date DATE NOT NULL UNIQUE,
    ram_peak_percent INTEGER,
    ram_peak_time TIMESTAMPTZ,
    cpu_avg_percent INTEGER,
    disk_percent INTEGER,
    messages_sent INTEGER DEFAULT 0,
    messages_failed INTEGER DEFAULT 0,
    active_senders INTEGER DEFAULT 0,
    new_users INTEGER DEFAULT 0,
    churned_trials INTEGER DEFAULT 0,
    daily_revenue NUMERIC(10,2) DEFAULT 0,
    mrr NUMERIC(10,2) DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_daily_reports_date ON daily_reports(report_date);
