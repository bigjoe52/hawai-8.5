-- The weekly parlay is a flat $10 ticket for the league, not a per-person
-- buy-in that adds up to a pot. Rename the column and set the new default.
--
-- Safe to run more than once: each step checks the current state first.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'parlays' AND column_name = 'stake_per_user_cents'
  ) THEN
    ALTER TABLE parlays RENAME COLUMN stake_per_user_cents TO stake_cents;
  END IF;
END $$;

ALTER TABLE parlays ALTER COLUMN stake_cents SET DEFAULT 1000;

-- Anything still carrying the old zero default becomes the standard $10.
UPDATE parlays SET stake_cents = 1000 WHERE stake_cents = 0;
