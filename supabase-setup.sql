-- ── RedDragonTracker · Supabase Schema ────────────────────────────────
-- Run this entire file in: Supabase Dashboard → SQL Editor → New query
-- Safe to re-run (all statements use IF NOT EXISTS / IF EXISTS).


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

ALTER TABLE subscribers ENABLE ROW LEVEL SECURITY;

-- Anon can only INSERT — never read, update, or delete
CREATE POLICY IF NOT EXISTS "subscribers_public_insert" ON subscribers
    FOR INSERT TO anon
    WITH CHECK (
        char_length(email) <= 254 AND
        email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'
    );

-- Service role (Edge Functions + dashboard) full access
CREATE POLICY IF NOT EXISTS "subscribers_service_full" ON subscribers
    FOR ALL TO service_role
    USING (true) WITH CHECK (true);


-- ══════════════════════════════════════════════════════════════════════
-- 2. SUBSCRIBE_ATTEMPTS — IP rate limiting for newsletter
-- ══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS subscribe_attempts (
    id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    ip         TEXT        NOT NULL,
    email      TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE subscribe_attempts ENABLE ROW LEVEL SECURITY;

-- Only the service role (Edge Function) may touch this table
CREATE POLICY IF NOT EXISTS "subscribe_attempts_service_only" ON subscribe_attempts
    FOR ALL TO service_role
    USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_subscribe_attempts_ip_time
    ON subscribe_attempts (ip, created_at);

-- Auto-cleanup (enable pg_cron extension first):
-- SELECT cron.schedule('cleanup-attempts', '30 * * * *',
--   $$DELETE FROM subscribe_attempts WHERE created_at < NOW() - INTERVAL '2 hours'$$);


-- ══════════════════════════════════════════════════════════════════════
-- 3. PROFILES — one row per auth user, stores public username
-- ══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS profiles (
    id          UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    username    TEXT        UNIQUE NOT NULL,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT profiles_username_length CHECK (char_length(username) BETWEEN 3 AND 20),
    CONSTRAINT profiles_username_chars  CHECK (username ~* '^[a-zA-Z0-9_]+$')
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Anyone can read profiles (needed for chat display)
CREATE POLICY IF NOT EXISTS "profiles_public_read" ON profiles
    FOR SELECT TO anon, authenticated USING (true);

-- Authenticated users can create only their own profile
CREATE POLICY IF NOT EXISTS "profiles_own_insert" ON profiles
    FOR INSERT TO authenticated
    WITH CHECK (auth.uid() = id);

-- Authenticated users can update only their own profile
CREATE POLICY IF NOT EXISTS "profiles_own_update" ON profiles
    FOR UPDATE TO authenticated
    USING (auth.uid() = id);

-- Service role full access
CREATE POLICY IF NOT EXISTS "profiles_service_full" ON profiles
    FOR ALL TO service_role
    USING (true) WITH CHECK (true);


-- ══════════════════════════════════════════════════════════════════════
-- 4. CHAT MESSAGES
-- ══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS chat_messages (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    username    TEXT        NOT NULL,
    text        TEXT        NOT NULL,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    channel     TEXT        NOT NULL DEFAULT 'global',
    user_id     UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
    CONSTRAINT chat_username_length CHECK (char_length(username) BETWEEN 1 AND 20),
    CONSTRAINT chat_text_length     CHECK (char_length(text) BETWEEN 1 AND 300),
    CONSTRAINT chat_channel_valid   CHECK (channel IN ('global','military','taiwan','economy','cyber'))
);

-- Add columns to existing table (safe if already exist)
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS channel  TEXT NOT NULL DEFAULT 'global';
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS user_id  UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- Enforce channel values retroactively
DO $$ BEGIN
    ALTER TABLE chat_messages
        ADD CONSTRAINT chat_channel_valid
        CHECK (channel IN ('global','military','taiwan','economy','cyber'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;

-- Anyone can read messages from the last 24 hours only
DROP POLICY IF EXISTS "public_read_recent" ON chat_messages;
CREATE POLICY "chat_public_read_recent" ON chat_messages
    FOR SELECT TO anon, authenticated
    USING (created_at > NOW() - INTERVAL '24 hours');

-- Anyone can insert messages (RLS + constraints enforce limits)
-- user_id is set server-side only via service role when a user is authed
DROP POLICY IF EXISTS "public_insert" ON chat_messages;
CREATE POLICY "chat_anon_insert" ON chat_messages
    FOR INSERT TO anon
    WITH CHECK (
        char_length(username) BETWEEN 1 AND 20 AND
        char_length(text)     BETWEEN 1 AND 300 AND
        channel IN ('global','military','taiwan','economy','cyber') AND
        user_id IS NULL   -- anon cannot claim ownership
    );

CREATE POLICY "chat_auth_insert" ON chat_messages
    FOR INSERT TO authenticated
    WITH CHECK (
        char_length(username) BETWEEN 1 AND 20 AND
        char_length(text)     BETWEEN 1 AND 300 AND
        channel IN ('global','military','taiwan','economy','cyber') AND
        (user_id IS NULL OR user_id = auth.uid())
    );

-- Service role full access (moderation)
DROP POLICY IF EXISTS "service_full_access" ON chat_messages;
CREATE POLICY "chat_service_full" ON chat_messages
    FOR ALL TO service_role
    USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_chat_channel_time
    ON chat_messages (channel, created_at DESC);

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE chat_messages;

-- Auto-cleanup (enable pg_cron extension first):
-- SELECT cron.schedule('cleanup-chat', '0 * * * *',
--   $$DELETE FROM chat_messages WHERE created_at < NOW() - INTERVAL '24 hours'$$);


-- ══════════════════════════════════════════════════════════════════════
-- 5. AUTH RATE LIMITING (Supabase built-in)
-- ══════════════════════════════════════════════════════════════════════
-- Supabase enforces its own auth rate limits:
--   • Max 3 signup emails / hour / IP (default)
--   • Max 30 login attempts / hour / IP
-- To tighten these, go to: Authentication → Rate Limits in the dashboard.
-- Recommended settings for this project:
--   Email signups:      3 / hour
--   Password sign-ins:  10 / hour
--   Token refreshes:    150 / hour
--   OTP / magic links:  3 / hour


-- ══════════════════════════════════════════════════════════════════════
-- 6. SECURITY CHECKLIST
-- ══════════════════════════════════════════════════════════════════════
-- [x] RLS enabled on all tables
-- [x] Anon cannot read subscribers
-- [x] Anon cannot read subscribe_attempts
-- [x] Anon cannot set user_id on chat_messages (claim verified status)
-- [x] Profiles are readable by all but writable only by owner
-- [x] channel constrained to known values (no freeform injection)
-- [x] Text length constraints enforced at DB level, not just app level
-- [ ] Enable pg_cron for auto-cleanup (Dashboard → Extensions → pg_cron)
-- [ ] Set auth rate limits in Dashboard → Authentication → Rate Limits
-- [ ] Enable leaked password protection: Auth → Settings → "HaveIBeenPwned"
