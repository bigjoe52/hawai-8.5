-- Two additions.
--
-- 1. Structured market data on generated bets, so a bet placed off the board
--    can be graded automatically from the final fantasy scores instead of the
--    commissioner clicking through every one.
-- 2. A payment step: a graded bet owes money until the winner says it landed.
--
-- Safe to re-run.

ALTER TABLE side_bets
  ADD COLUMN IF NOT EXISTS market_kind       TEXT,
  ADD COLUMN IF NOT EXISTS line_value        NUMERIC(7,2),
  ADD COLUMN IF NOT EXISTS proposer_pick     TEXT,
  ADD COLUMN IF NOT EXISTS home_roster_id    INTEGER,
  ADD COLUMN IF NOT EXISTS away_roster_id    INTEGER,
  ADD COLUMN IF NOT EXISTS subject_roster_id INTEGER,
  ADD COLUMN IF NOT EXISTS auto_settled      BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS paid_at           TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS paid_by           INTEGER REFERENCES users(id);

-- 'settled' splits into 'unpaid' (graded, money still owed) and 'paid'.
DO $$
BEGIN
  ALTER TABLE side_bets DROP CONSTRAINT IF EXISTS side_bets_status_check;
  ALTER TABLE side_bets ADD CONSTRAINT side_bets_status_check
    CHECK (status IN ('open','matched','unpaid','paid','void'));
END $$;

-- Anything already graded is treated as still owing, since the site had no way
-- to record a payment before now.
UPDATE side_bets SET status = 'unpaid' WHERE status = 'settled';

-- A graded bet must still name a winner.
DO $$
BEGIN
  ALTER TABLE side_bets DROP CONSTRAINT IF EXISTS settled_needs_winner;
  ALTER TABLE side_bets ADD CONSTRAINT settled_needs_winner
    CHECK (status NOT IN ('unpaid','paid') OR winner IS NOT NULL);
END $$;

DO $$
BEGIN
  ALTER TABLE side_bets DROP CONSTRAINT IF EXISTS matched_needs_taker;
  ALTER TABLE side_bets ADD CONSTRAINT matched_needs_taker
    CHECK (status IN ('open','void') OR taker_id IS NOT NULL);
END $$;

CREATE INDEX IF NOT EXISTS idx_bets_auto ON side_bets(season, week, status)
  WHERE market_kind IS NOT NULL;
