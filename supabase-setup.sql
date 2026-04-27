-- ── RedDragonTracker · Supabase Schema ────────────────────────────────
-- Run this entire file in: Supabase Dashboard → SQL Editor → New query


-- ══════════════════════════════════════════════════════════════════════
-- 1. SUBSCRIBERS — newsletter signups
-- ══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS subscribers (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    email       TEXT        NOT NULL,
    source      TEXT        DEFAULT 'RedDragonTracker',
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT subscribers_email_unique UNIQUE (email),
    CONSTRAINT subscribers_email_format CHECK (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
    CONSTRAINT subscribers_email_length CHECK (char_length(email) <= 254)
);

-- RLS on subscribers
ALTER TABLE subscribers ENABLE ROW LEVEL SECURITY;

-- Anon can only INSERT (subscribe) — never read, update, or delete
CREATE POLICY "public_insert_only" ON subscribers
    FOR INSERT
    TO anon
    WITH CHECK (
        char_length(email) <= 254 AND
        email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'
    );

-- Service role (your dashboard) can read everything
CREATE POLICY "service_full_access" ON subscribers
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);


-- ══════════════════════════════════════════════════════════════════════
-- 2. CHAT MESSAGES — replaces Gun.js P2P
-- ══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS chat_messages (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    username    TEXT        NOT NULL,
    text        TEXT        NOT NULL,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT chat_username_length CHECK (char_length(username) BETWEEN 1 AND 20),
    CONSTRAINT chat_text_length     CHECK (char_length(text) BETWEEN 1 AND 300)
);

-- RLS on chat_messages
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;

-- Anon can read messages from the last 24 hours only
CREATE POLICY "public_read_recent" ON chat_messages
    FOR SELECT
    TO anon
    USING (created_at > NOW() - INTERVAL '24 hours');

-- Anon can insert messages (constraints enforce length limits)
CREATE POLICY "public_insert" ON chat_messages
    FOR INSERT
    TO anon
    WITH CHECK (
        char_length(username) BETWEEN 1 AND 20 AND
        char_length(text) BETWEEN 1 AND 300
    );

-- Service role full access (for moderation)
CREATE POLICY "service_full_access" ON chat_messages
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);


-- ══════════════════════════════════════════════════════════════════════
-- 3. SUBSCRIBE_ATTEMPTS — server-side rate limiting for newsletter
-- ══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS subscribe_attempts (
    id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    ip         TEXT        NOT NULL,
    email      TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Only accessible by service role (Edge Function) — never by anon
ALTER TABLE subscribe_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_only" ON subscribe_attempts
    FOR ALL TO service_role
    USING (true) WITH CHECK (true);

-- Fast lookup by IP + time window
CREATE INDEX IF NOT EXISTS subscribe_attempts_ip_time
    ON subscribe_attempts (ip, created_at);

-- Auto-cleanup: delete records older than 2 hours (keeps table tiny)
-- Enable pg_cron first: Database → Extensions → pg_cron → Enable
-- SELECT cron.schedule('cleanup-attempts', '30 * * * *',
--   $$DELETE FROM subscribe_attempts WHERE created_at < NOW() - INTERVAL '2 hours'$$
-- );


-- ══════════════════════════════════════════════════════════════════════
-- 4. AUTO-DELETE old chat messages (keep DB clean)
-- ══════════════════════════════════════════════════════════════════════
-- Deletes messages older than 24h — runs every hour via pg_cron
-- (enable pg_cron extension first: Database → Extensions → pg_cron)
-- SELECT cron.schedule('cleanup-chat', '0 * * * *',
--   $$DELETE FROM chat_messages WHERE created_at < NOW() - INTERVAL '24 hours'$$
-- );


-- ══════════════════════════════════════════════════════════════════════
-- 4. ENABLE REALTIME on chat_messages
-- ══════════════════════════════════════════════════════════════════════
-- Run this so Supabase broadcasts new inserts to subscribed clients:
ALTER PUBLICATION supabase_realtime ADD TABLE chat_messages;
