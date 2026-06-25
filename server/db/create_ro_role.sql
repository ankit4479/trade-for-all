-- Read-only DB role for the Postgres MCP server.
-- SELECT-only on all tables in `public` — the MCP can never write, even with a bug.
-- The `tfa` app role lacks CREATEROLE, so this must run as the postgres superuser.
--
-- Run (choose your own strong password — it is passed as a psql variable so it
-- never lives in this file, the repo, or the Claude session).
-- NOTE: use plain shell single-quotes, NO inner quotes — the SQL below already
-- quotes the value via :'ro_password'. Adding inner quotes makes them part of
-- the password.
--
--   /Library/PostgreSQL/18/bin/psql -U postgres -h localhost -d trade_for_all \
--     -v ro_password='CHOOSE_A_STRONG_PASSWORD' -f server/db/create_ro_role.sql
--
-- Then the read-only connection URI for the MCP is:
--   postgresql://tfa_ro:<that-password>@localhost:5432/trade_for_all

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tfa_ro') THEN
    CREATE ROLE tfa_ro LOGIN;
  END IF;
END $$;

ALTER ROLE tfa_ro WITH LOGIN PASSWORD :'ro_password';

GRANT CONNECT ON DATABASE trade_for_all TO tfa_ro;
GRANT USAGE ON SCHEMA public TO tfa_ro;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO tfa_ro;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO tfa_ro;

-- Verify: should list only SELECT
SELECT DISTINCT privilege_type
FROM information_schema.role_table_grants
WHERE grantee = 'tfa_ro';
