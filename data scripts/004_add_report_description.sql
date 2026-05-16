-- Migration 004: Add description to report_history
-- Run this in the Supabase SQL Editor

ALTER TABLE report_history 
ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT 'Customise your report by dragging widgets from the right sidebar.';
