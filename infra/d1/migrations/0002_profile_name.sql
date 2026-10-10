-- VeilVPN D1 migration 0002: profile display name.
-- The users table has no name column in 0001; PATCH /v1/me manages it.
ALTER TABLE users ADD COLUMN name TEXT;
