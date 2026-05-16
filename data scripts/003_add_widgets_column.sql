-- Migration 003: Add widgets to report_history
-- Run this in the Supabase SQL Editor

ALTER TABLE report_history 
ADD COLUMN IF NOT EXISTS widgets JSONB NOT NULL DEFAULT '[]'::jsonb;
