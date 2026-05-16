-- Migration 005: Scheduled reports table
-- Run in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS scheduled_reports (
    id          TEXT PRIMARY KEY,
    user_id     UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    widget_ids  TEXT[] NOT NULL DEFAULT '{}',
    frequency   TEXT NOT NULL CHECK (frequency IN ('daily', 'weekly')),
    day_of_week INT CHECK (day_of_week BETWEEN 0 AND 6),  -- 0=Mon … 6=Sun, NULL if daily
    hour        INT NOT NULL DEFAULT 9 CHECK (hour BETWEEN 0 AND 23),
    email       TEXT NOT NULL,
    enabled     BOOLEAN NOT NULL DEFAULT TRUE,
    next_run_at TIMESTAMPTZ,
    last_run_at TIMESTAMPTZ,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE scheduled_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own_schedules" ON scheduled_reports
    FOR ALL USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_scheduled_reports_next_run
    ON scheduled_reports(next_run_at) WHERE enabled = TRUE;

CREATE INDEX IF NOT EXISTS idx_scheduled_reports_user
    ON scheduled_reports(user_id);
