"""
Ensure optional DB objects exist. Uses direct Postgres when SUPABASE_DB_URL / DATABASE_URL
is set so API keys work without a manual SQL Editor step. Still supports running
supabase_migration_user_api_keys.sql for projects that only use SUPABASE_URL + SUPABASE_KEY.
"""

from __future__ import annotations

import os

_api_keys_verified: bool = False


def is_missing_user_api_keys_table_error(err_str: str) -> bool:
    s = (err_str or "").lower()
    return (
        "user_api_keys" in s
        or "pgrst205" in s
        or "does not exist" in s
        or "schema cache" in s
    )


def _run_user_api_keys_ddl(conn) -> None:
    stmts = [
        """
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
)
""".strip(),
        "CREATE INDEX IF NOT EXISTS idx_user_api_keys_user_id ON user_api_keys(user_id)",
        "CREATE INDEX IF NOT EXISTS idx_user_api_keys_lookup_id ON user_api_keys(lookup_id)",
    ]
    cur = conn.cursor()
    try:
        for stmt in stmts:
            cur.execute(stmt)
        try:
            cur.execute("NOTIFY pgrst, 'reload schema'")
        except Exception:
            pass
    finally:
        cur.close()


def migrate_user_api_keys_via_postgres() -> bool:
    """Create user_api_keys via direct Postgres. Returns True if DDL ran without exception."""
    db_url = (
        (os.getenv("SUPABASE_DB_URL") or os.getenv("DATABASE_URL") or os.getenv("SUPABASE_POSTGRES_URL") or "")
        .strip()
    )
    if not db_url:
        return False
    try:
        import psycopg2
    except ImportError:
        print("[API_KEYS] Install psycopg2-binary for automatic table creation from DATABASE_URL.", flush=True)
        return False
    try:
        conn = psycopg2.connect(db_url)
        conn.autocommit = True
        _run_user_api_keys_ddl(conn)
        conn.close()
        print("[API_KEYS] Ensured user_api_keys table via Postgres.", flush=True)
        return True
    except Exception as e:
        print(f"[API_KEYS] Postgres DDL failed: {e}", flush=True)
        return False


def try_ensure_user_api_keys_table(*, reset: bool = False) -> bool:
    """
    Return True if user_api_keys is reachable via Supabase REST, or was just created.
    If reset=True, clear cache and re-check (e.g. after a failed insert).
    """
    global _api_keys_verified
    if reset:
        _api_keys_verified = False
    if _api_keys_verified:
        return True

    from database import get_supabase

    try:
        get_supabase().table("user_api_keys").select("id").limit(1).execute()
        _api_keys_verified = True
        return True
    except Exception as e:
        if not is_missing_user_api_keys_table_error(str(e)):
            raise

    if migrate_user_api_keys_via_postgres():
        import time

        for i in range(5):
            try:
                get_supabase().table("user_api_keys").select("id").limit(1).execute()
                _api_keys_verified = True
                return True
            except Exception as e2:
                if i < 4 and is_missing_user_api_keys_table_error(str(e2)):
                    time.sleep(0.4)
                    continue
                print(f"[API_KEYS] PostgREST still cannot see user_api_keys: {e2}", flush=True)
                return False

    return False


def detail_table_missing_help() -> str:
    return (
        "Database table user_api_keys is missing. Fix one of: "
        "(1) Supabase Dashboard → SQL Editor → paste and run Backend/supabase_migration_user_api_keys.sql; "
        "(2) Set SUPABASE_DB_URL or DATABASE_URL (Postgres connection string from Supabase Project Settings → Database) "
        "on your server and install psycopg2-binary, then redeploy so the table is created automatically."
    )


# ---------- contact_submissions (public /contact form) ----------
_contact_table_verified: bool = False


def is_missing_contact_submissions_table_error(err_str: str) -> bool:
    s = (err_str or "").lower()
    return (
        "contact_submissions" in s
        or "pgrst205" in s
        or "does not exist" in s
        or "schema cache" in s
    )


def _run_contact_submissions_ddl(conn) -> None:
    stmts = [
        """
CREATE TABLE IF NOT EXISTS contact_submissions (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  category TEXT NOT NULL,
  message TEXT NOT NULL
)
""".strip(),
        "CREATE INDEX IF NOT EXISTS idx_contact_submissions_created_at ON contact_submissions (created_at DESC)",
        "ALTER TABLE contact_submissions DROP COLUMN IF EXISTS subject",
    ]
    cur = conn.cursor()
    try:
        for stmt in stmts:
            cur.execute(stmt)
        try:
            cur.execute("NOTIFY pgrst, 'reload schema'")
        except Exception:
            pass
    finally:
        cur.close()


def migrate_contact_submissions_via_postgres() -> bool:
    db_url = (
        (os.getenv("SUPABASE_DB_URL") or os.getenv("DATABASE_URL") or os.getenv("SUPABASE_POSTGRES_URL") or "")
        .strip()
    )
    if not db_url:
        return False
    try:
        import psycopg2
    except ImportError:
        print(
            "[CONTACT] Install psycopg2-binary for automatic contact_submissions table from DATABASE_URL.",
            flush=True,
        )
        return False
    try:
        conn = psycopg2.connect(db_url)
        conn.autocommit = True
        _run_contact_submissions_ddl(conn)
        conn.close()
        print("[CONTACT] Ensured contact_submissions table via Postgres.", flush=True)
        return True
    except Exception as e:
        print(f"[CONTACT] Postgres DDL failed: {e}", flush=True)
        return False


def try_ensure_contact_submissions_table(*, reset: bool = False) -> bool:
    global _contact_table_verified
    if reset:
        _contact_table_verified = False
    if _contact_table_verified:
        return True

    from database import get_supabase

    try:
        get_supabase().table("contact_submissions").select("id").limit(1).execute()
        _contact_table_verified = True
        return True
    except Exception as e:
        if not is_missing_contact_submissions_table_error(str(e)):
            raise

    if migrate_contact_submissions_via_postgres():
        import time

        for i in range(5):
            try:
                get_supabase().table("contact_submissions").select("id").limit(1).execute()
                _contact_table_verified = True
                return True
            except Exception as e2:
                if i < 4 and is_missing_contact_submissions_table_error(str(e2)):
                    time.sleep(0.4)
                    continue
                print(f"[CONTACT] PostgREST still cannot see contact_submissions: {e2}", flush=True)
                return False

    return False


def detail_contact_table_missing_help() -> str:
    return (
        "Table contact_submissions is missing. Run Backend/supabase_migration_contact_submissions.sql in the "
        "Supabase SQL Editor, or set SUPABASE_DB_URL / DATABASE_URL for automatic creation on startup."
    )
