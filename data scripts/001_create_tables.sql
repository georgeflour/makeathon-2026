-- Migration 001: Create tables from DuckDB flat views
-- Run this in Supabase SQL Editor before running migrate.py

CREATE TABLE IF NOT EXISTS conversations (
    conversation_id    TEXT PRIMARY KEY,
    agent_id           TEXT,
    agent_name         TEXT,
    user_id            TEXT,
    status             TEXT,
    start_time         TIMESTAMPTZ,
    start_date         DATE,
    start_hour         INTEGER,
    start_dow          INTEGER,
    call_duration_secs BIGINT,
    cost_amount        DOUBLE PRECISION,
    cost_currency      TEXT,
    call_direction     TEXT,
    from_number        TEXT,
    termination_reason TEXT,
    bot_version        TEXT,
    transcript_summary TEXT,
    call_successful    TEXT,
    main_language      TEXT,
    dv_user_id         TEXT,
    segment            TEXT,
    region             TEXT,
    preferred_language TEXT,
    channel_origin     TEXT,
    csat_score         DOUBLE PRECISION,
    csat_collected     BOOLEAN GENERATED ALWAYS AS (csat_score IS NOT NULL) STORED,
    outcome            TEXT
);

CREATE TABLE IF NOT EXISTS turns (
    id                 BIGSERIAL PRIMARY KEY,
    conversation_id    TEXT REFERENCES conversations(conversation_id),
    start_time         TIMESTAMPTZ,
    agent_id           TEXT,
    main_language      TEXT,
    role               TEXT,
    time_in_call_secs  BIGINT,
    message            TEXT,
    detected_intent    TEXT,
    intent_confidence  DOUBLE PRECISION,
    sentiment          TEXT,
    turn_number        BIGINT,
    tool_calls_count   BIGINT
);

CREATE TABLE IF NOT EXISTS evaluations (
    id                 BIGSERIAL PRIMARY KEY,
    conversation_id    TEXT REFERENCES conversations(conversation_id),
    start_time         TIMESTAMPTZ,
    agent_id           TEXT,
    bot_version        TEXT,
    main_language      TEXT,
    segment            TEXT,
    region             TEXT,
    criterion_id       TEXT,
    result             TEXT,
    rationale          TEXT
);

CREATE TABLE IF NOT EXISTS data_collection (
    id                 BIGSERIAL PRIMARY KEY,
    conversation_id    TEXT REFERENCES conversations(conversation_id),
    start_time         TIMESTAMPTZ,
    agent_id           TEXT,
    bot_version        TEXT,
    main_language      TEXT,
    segment            TEXT,
    region             TEXT,
    field_id           TEXT,
    value              TEXT,
    rationale          TEXT
);

CREATE TABLE IF NOT EXISTS tool_calls (
    id                 BIGSERIAL PRIMARY KEY,
    conversation_id    TEXT REFERENCES conversations(conversation_id),
    start_time         TIMESTAMPTZ,
    agent_id           TEXT,
    main_language      TEXT,
    time_in_call_secs  BIGINT,
    tool_name          TEXT,
    success            BOOLEAN,
    latency_ms         BIGINT
);

-- Indexes για γρήγορα queries στο dashboard
CREATE INDEX IF NOT EXISTS idx_conversations_start_time  ON conversations(start_time);
CREATE INDEX IF NOT EXISTS idx_conversations_bot_version ON conversations(bot_version);
CREATE INDEX IF NOT EXISTS idx_conversations_segment     ON conversations(segment);
CREATE INDEX IF NOT EXISTS idx_conversations_outcome     ON conversations(outcome);

CREATE INDEX IF NOT EXISTS idx_turns_conversation_id     ON turns(conversation_id);
CREATE INDEX IF NOT EXISTS idx_turns_sentiment           ON turns(sentiment);
CREATE INDEX IF NOT EXISTS idx_turns_detected_intent     ON turns(detected_intent);

CREATE INDEX IF NOT EXISTS idx_evaluations_conversation  ON evaluations(conversation_id);
CREATE INDEX IF NOT EXISTS idx_evaluations_criterion     ON evaluations(criterion_id);
CREATE INDEX IF NOT EXISTS idx_evaluations_result        ON evaluations(result);

CREATE INDEX IF NOT EXISTS idx_data_collection_conv      ON data_collection(conversation_id);
CREATE INDEX IF NOT EXISTS idx_data_collection_field     ON data_collection(field_id);

CREATE INDEX IF NOT EXISTS idx_tool_calls_conversation   ON tool_calls(conversation_id);
CREATE INDEX IF NOT EXISTS idx_tool_calls_tool_name      ON tool_calls(tool_name);
