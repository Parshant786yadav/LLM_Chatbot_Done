-- One-time: remove legacy `subject` column from contact_submissions (optional if you use updated supabase_migration_contact_submissions.sql end block).
ALTER TABLE contact_submissions DROP COLUMN IF EXISTS subject;
