-- Run once in Supabase SQL Editor (existing projects that already ran supabase_schema.sql).
-- API keys: per-chat (only that chat's uploads) or global (only account global uploads).

CREATE TABLE IF NOT EXISTS user_api_keys (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope TEXT NOT NULL CHECK (scope IN ('chat', 'global')),
  chat_id BIGINT REFERENCES chats(id) ON DELETE CASCADE,
  lookup_id TEXT NOT NULL UNIQUE,
  key_hash TEXT NOT NULL,
  label TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  CONSTRAINT user_api_keys_scope_chat CHECK (
    (scope = 'global' AND chat_id IS NULL)
    OR (scope = 'chat' AND chat_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_user_api_keys_user_id ON user_api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_user_api_keys_lookup_id ON user_api_keys(lookup_id);
