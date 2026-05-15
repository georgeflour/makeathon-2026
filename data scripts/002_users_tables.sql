-- Migration 002: App users, chat history, report history
-- Run in Supabase SQL Editor after 001_create_tables.sql

-- App users linked to Supabase Auth
CREATE TABLE IF NOT EXISTS app_users (
    id                   UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email                TEXT NOT NULL,
    display_name         TEXT,
    onboarding_completed BOOLEAN NOT NULL DEFAULT FALSE,
    settings             JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Chat history (full message array stored as JSONB)
CREATE TABLE IF NOT EXISTS chat_history (
    id         TEXT PRIMARY KEY,
    user_id    UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
    name       TEXT NOT NULL DEFAULT 'New Chat',
    messages   JSONB NOT NULL DEFAULT '[]'::jsonb,
    pinned     BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Report history
CREATE TABLE IF NOT EXISTS report_history (
    id         TEXT PRIMARY KEY,
    user_id    UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
    name       TEXT NOT NULL DEFAULT 'New Report',
    pinned     BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Row Level Security: users can only access their own rows
ALTER TABLE app_users      ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_history   ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own_profile_select" ON app_users    FOR SELECT USING (auth.uid() = id);
CREATE POLICY "own_profile_insert" ON app_users    FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "own_profile_update" ON app_users    FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "own_chats"   ON chat_history   FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "own_reports" ON report_history FOR ALL USING (auth.uid() = user_id);

-- Auto-update updated_at on chat_history rows
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER chat_history_updated_at
    BEFORE UPDATE ON chat_history
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER report_history_updated_at
    BEFORE UPDATE ON report_history
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
