-- Migration: Add composite index for fast message retrieval
-- Feature: fast-chat-history-loading
-- Purpose: Optimize message queries by chat_id with ordering by id

-- Create composite index on messages table for optimal query performance
-- This index supports queries like: SELECT * FROM messages WHERE chat_id = ? ORDER BY id ASC
-- Note: Using regular CREATE INDEX (not CONCURRENTLY) since Supabase SQL Editor runs in transaction
CREATE INDEX IF NOT EXISTS idx_messages_chat_id_id 
ON messages(chat_id, id);

-- Verify the index was created
-- Run this in Supabase SQL Editor to verify:
-- EXPLAIN ANALYZE SELECT id, role, content, display_id 
-- FROM messages 
-- WHERE chat_id = 1 
-- ORDER BY id ASC;
-- 
-- Expected: Should show "Index Scan using idx_messages_chat_id_id"
