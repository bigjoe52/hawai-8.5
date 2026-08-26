-- Moneyline bets are not even money: the favourite risks more than the
-- underdog. Record what each side puts up rather than one shared stake.
--
-- Safe to re-run.

ALTER TABLE side_bets
  ADD COLUMN IF NOT EXISTS taker_stake_cents INTEGER NOT NULL DEFAULT 0;

-- Everything that existed before was settled straight up, so both sides
-- risked the same amount.
UPDATE side_bets
SET taker_stake_cents = stake_cents
WHERE taker_stake_cents = 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
    WHERE table_name = 'side_bets' AND constraint_name = 'taker_stake_non_negative'
  ) THEN
    ALTER TABLE side_bets
      ADD CONSTRAINT taker_stake_non_negative CHECK (taker_stake_cents >= 0);
  END IF;
END $$;
