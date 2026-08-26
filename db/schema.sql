-- Hawaii Fantasy League -- database schema
-- All money is stored as INTEGER CENTS. Never use floats for money.

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  display_name  TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  is_admin      BOOLEAN NOT NULL DEFAULT FALSE,
  -- Optional: links this login to a Sleeper account so we can match up
  -- fantasy matchups to the right person.
  sleeper_user_id TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One league-wide parlay per (season, week). Every member adds exactly one leg.
CREATE TABLE IF NOT EXISTS parlays (
  id                   SERIAL PRIMARY KEY,
  season               INTEGER NOT NULL,
  week                 INTEGER NOT NULL,
  -- open   = still accepting legs
  -- locked = legs frozen, games in progress
  -- won / lost = graded
  status               TEXT NOT NULL DEFAULT 'open'
                       CHECK (status IN ('open','locked','won','lost')),
  -- Flat stake for the whole ticket, not per person. $10 by default.
  stake_cents          INTEGER NOT NULL DEFAULT 1000
                       CHECK (stake_cents >= 0),
  notes                TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_at            TIMESTAMPTZ,
  UNIQUE (season, week)
);

-- One leg per user per parlay. The UNIQUE constraint is what enforces
-- "each user puts in one leg" at the database level.
CREATE TABLE IF NOT EXISTS parlay_legs (
  id            SERIAL PRIMARY KEY,
  parlay_id     INTEGER NOT NULL REFERENCES parlays(id) ON DELETE CASCADE,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Free text, e.g. "Chiefs -3.5 vs Broncos" or "Bijan Robinson over 74.5 rush yds"
  description   TEXT NOT NULL,
  -- American odds: -110, +250, etc. Stored as a signed integer.
  odds_american INTEGER NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','win','loss','push')),
  graded_by     INTEGER REFERENCES users(id),
  graded_at     TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (parlay_id, user_id)
);

-- Head-to-head side bets on the fantasy matchups. One user posts it,
-- another user takes the other side.
CREATE TABLE IF NOT EXISTS side_bets (
  id             SERIAL PRIMARY KEY,
  season         INTEGER NOT NULL,
  week           INTEGER NOT NULL,
  proposer_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title          TEXT NOT NULL,
  details        TEXT,
  -- What each side is actually backing, in plain words.
  proposer_side  TEXT NOT NULL,
  taker_side     TEXT NOT NULL,
  -- What the proposer puts up.
  stake_cents    INTEGER NOT NULL CHECK (stake_cents > 0),
  -- What the taker puts up. Equal to stake_cents for a straight-up bet; for a
  -- moneyline it is the other side of the price, so the favourite risks more
  -- than the underdog. Whoever loses pays what they risked.
  taker_stake_cents INTEGER NOT NULL DEFAULT 0 CHECK (taker_stake_cents >= 0),
  -- open    = nobody has taken the other side yet
  -- matched = someone took it, waiting on the result
  -- unpaid  = graded, the loser owes the winner
  -- paid    = the winner confirmed the money arrived
  -- void    = cancelled or pushed, no money moves
  status         TEXT NOT NULL DEFAULT 'open'
                 CHECK (status IN ('open','matched','unpaid','paid','void')),
  taker_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  taken_at       TIMESTAMPTZ,
  winner         TEXT CHECK (winner IN ('proposer','taker','push')),
  settled_by     INTEGER REFERENCES users(id),
  settled_at     TIMESTAMPTZ,
  -- Optional pointer at the Sleeper matchup this bet is about.
  sleeper_matchup_id TEXT,

  -- Structured market data, present only on bets placed off the generated
  -- board. These are what make a bet gradeable without a human reading it:
  -- what kind of market, the number, and which side the proposer took.
  market_kind       TEXT,          -- moneyline | spread | total | team_total
  line_value        NUMERIC(7,2),
  proposer_pick     TEXT,          -- home | away | over | under
  home_roster_id    INTEGER,
  away_roster_id    INTEGER,
  subject_roster_id INTEGER,       -- whose total, for team_total
  auto_settled      BOOLEAN NOT NULL DEFAULT FALSE,

  paid_at        TIMESTAMPTZ,
  paid_by        INTEGER REFERENCES users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- You cannot take your own bet.
  CONSTRAINT no_self_take CHECK (taker_id IS NULL OR taker_id <> proposer_id),
  -- A settled bet must have a winner; an open bet must not.
  CONSTRAINT settled_needs_winner CHECK (
    status NOT IN ('unpaid','paid') OR winner IS NOT NULL
  ),
  CONSTRAINT matched_needs_taker CHECK (
    status IN ('open','void') OR taker_id IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS idx_legs_parlay   ON parlay_legs(parlay_id);
CREATE INDEX IF NOT EXISTS idx_legs_user     ON parlay_legs(user_id);
CREATE INDEX IF NOT EXISTS idx_bets_week     ON side_bets(season, week);
CREATE INDEX IF NOT EXISTS idx_bets_status   ON side_bets(status);
CREATE INDEX IF NOT EXISTS idx_bets_proposer ON side_bets(proposer_id);
CREATE INDEX IF NOT EXISTS idx_bets_taker    ON side_bets(taker_id);
