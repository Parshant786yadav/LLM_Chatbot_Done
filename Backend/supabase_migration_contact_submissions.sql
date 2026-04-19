-- DocuMind: public contact form submissions (admin Database tab: contact_submissions)
-- Run in Supabase SQL Editor if auto-create via DATABASE_URL is not used.

CREATE TABLE IF NOT EXISTS contact_submissions (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  category TEXT NOT NULL,
  message TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_contact_submissions_created_at
  ON contact_submissions (created_at DESC);

-- Remove legacy column if you created this table before `subject` was dropped:
ALTER TABLE contact_submissions DROP COLUMN IF EXISTS subject;

COMMENT ON TABLE contact_submissions IS 'Messages from /contact form; view in admin Database.';

-- If your backend uses the anon key (not service_role), allow inserts for this table only:
-- ALTER TABLE contact_submissions ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY contact_submissions_insert_anon ON contact_submissions
--   FOR INSERT TO anon WITH CHECK (true);
-- (Adjust role name if needed; service_role bypasses RLS.)
