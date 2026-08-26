-- Whoever finishes last in a week places the following week's parlay.
--
-- The placer is worked out from Sleeper's final scores, so each member needs
-- to be linked to their Sleeper account. That link is on users.sleeper_user_id
-- and uses Sleeper's immutable user_id -- not the display name, and definitely
-- not the team name, both of which people change.
--
-- Safe to re-run.

ALTER TABLE parlays
  ADD COLUMN IF NOT EXISTS placer_user_id INTEGER REFERENCES users(id);

CREATE INDEX IF NOT EXISTS idx_users_sleeper ON users(sleeper_user_id)
  WHERE sleeper_user_id IS NOT NULL;
