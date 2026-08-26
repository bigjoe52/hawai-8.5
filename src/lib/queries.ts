import { sql } from "./db.ts";
import type { LegStatus } from "./odds.ts";
import type { SettledBet } from "./ledger.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */

export type LeagueMember = {
  id: number;
  username: string;
  displayName: string;
  isAdmin: boolean;
  sleeperUserId: string | null;
};

export type ParlayLeg = {
  id: number;
  userId: number;
  displayName: string;
  description: string;
  oddsAmerican: number;
  status: LegStatus;
};

export type Parlay = {
  id: number;
  season: number;
  week: number;
  status: "open" | "locked" | "won" | "lost";
  stakeCents: number;
  notes: string | null;
  legs: ParlayLeg[];
};

export type SideBet = {
  id: number;
  season: number;
  week: number;
  proposerId: number;
  proposerName: string;
  takerId: number | null;
  takerName: string | null;
  title: string;
  details: string | null;
  proposerSide: string;
  takerSide: string;
  stakeCents: number;
  takerStakeCents: number;
  status: "open" | "matched" | "unpaid" | "paid" | "void";
  winner: "proposer" | "taker" | "push" | null;
  /** Set only on bets placed off the generated board -- these can auto-grade. */
  marketKind: string | null;
  autoSettled: boolean;
  paidAt: string | null;
};

export async function listMembers(): Promise<LeagueMember[]> {
  const rows = await sql`
    SELECT id, username, display_name, is_admin, sleeper_user_id
    FROM users ORDER BY display_name
  `;
  return rows.map((r: any) => ({
    id: r.id,
    username: r.username,
    displayName: r.display_name,
    isAdmin: r.is_admin,
    sleeperUserId: r.sleeper_user_id,
  }));
}

/**
 * Fetch a week's parlay with all its legs. Creates the parlay row on first
 * access so nobody has to remember to "open" the week -- the first person to
 * visit the page that week starts it.
 */
export async function getOrCreateParlay(
  season: number,
  week: number,
): Promise<Parlay> {
  await sql`
    INSERT INTO parlays (season, week) VALUES (${season}, ${week})
    ON CONFLICT (season, week) DO NOTHING
  `;

  const [parlay] = await sql<{
    id: number;
    season: number;
    week: number;
    status: Parlay["status"];
    stake_cents: number;
    notes: string | null;
  }>`
    SELECT id, season, week, status, stake_cents, notes
    FROM parlays WHERE season = ${season} AND week = ${week}
  `;

  const legs = await sql`
    SELECT l.id, l.user_id, u.display_name, l.description, l.odds_american, l.status
    FROM parlay_legs l
    JOIN users u ON u.id = l.user_id
    WHERE l.parlay_id = ${parlay.id}
    ORDER BY l.created_at
  `;

  return {
    id: parlay.id,
    season: parlay.season,
    week: parlay.week,
    status: parlay.status,
    stakeCents: parlay.stake_cents,
    notes: parlay.notes,
    legs: legs.map((l: any) => ({
      id: l.id,
      userId: l.user_id,
      displayName: l.display_name,
      description: l.description,
      oddsAmerican: l.odds_american,
      status: l.status,
    })),
  };
}

/** Every week that has a parlay, newest first -- for the history page. */
export async function listParlayWeeks(): Promise<
  Array<{ season: number; week: number; status: string; legCount: number }>
> {
  const rows = await sql`
    SELECT p.season, p.week, p.status, COUNT(l.id)::int AS leg_count
    FROM parlays p
    LEFT JOIN parlay_legs l ON l.parlay_id = p.id
    GROUP BY p.id, p.season, p.week, p.status
    ORDER BY p.season DESC, p.week DESC
  `;
  return rows.map((r: any) => ({
    season: r.season,
    week: r.week,
    status: r.status,
    legCount: r.leg_count,
  }));
}

function toSideBet(r: any): SideBet {
  return {
    id: r.id,
    season: r.season,
    week: r.week,
    proposerId: r.proposer_id,
    proposerName: r.proposer_name,
    takerId: r.taker_id,
    takerName: r.taker_name,
    title: r.title,
    details: r.details,
    proposerSide: r.proposer_side,
    takerSide: r.taker_side,
    stakeCents: r.stake_cents,
    takerStakeCents: r.taker_stake_cents,
    status: r.status,
    winner: r.winner,
    marketKind: r.market_kind,
    autoSettled: r.auto_settled,
    paidAt: r.paid_at,
  };
}

/** All side bets posted for a given week, newest first. */
export async function listSideBets(
  season: number,
  week: number,
): Promise<SideBet[]> {
  const rows = await sql`
    SELECT b.id, b.season, b.week, b.proposer_id, b.taker_id, b.title,
           b.details, b.proposer_side, b.taker_side, b.stake_cents,
           b.taker_stake_cents, b.status, b.winner,
           b.market_kind, b.auto_settled, b.paid_at,
           p.display_name AS proposer_name,
           t.display_name AS taker_name
    FROM side_bets b
    JOIN users p ON p.id = b.proposer_id
    LEFT JOIN users t ON t.id = b.taker_id
    WHERE b.season = ${season} AND b.week = ${week}
    ORDER BY
      CASE b.status
        WHEN 'open' THEN 0 WHEN 'matched' THEN 1
        WHEN 'unpaid' THEN 2 ELSE 3 END,
      b.created_at DESC
  `;
  return rows.map(toSideBet);
}

/** Bets that are matched but not yet graded -- the commissioner's to-do list. */
export async function listUnsettledBets(): Promise<SideBet[]> {
  const rows = await sql`
    SELECT b.id, b.season, b.week, b.proposer_id, b.taker_id, b.title,
           b.details, b.proposer_side, b.taker_side, b.stake_cents,
           b.taker_stake_cents, b.status, b.winner,
           b.market_kind, b.auto_settled, b.paid_at,
           p.display_name AS proposer_name,
           t.display_name AS taker_name
    FROM side_bets b
    JOIN users p ON p.id = b.proposer_id
    LEFT JOIN users t ON t.id = b.taker_id
    WHERE b.status = 'matched'
    ORDER BY b.season DESC, b.week DESC, b.created_at
  `;
  return rows.map(toSideBet);
}

/**
 * Every graded bet, whether or not the money has changed hands.
 *
 * This is what the standings run on: a win is a win once the games are over,
 * regardless of whether anybody has settled up yet.
 */
export async function listGradedBets(): Promise<SettledBet[]> {
  const rows = await sql`
    SELECT id, proposer_id, taker_id, stake_cents, taker_stake_cents, winner
    FROM side_bets
    WHERE status IN ('unpaid', 'paid', 'void')
      AND taker_id IS NOT NULL
      AND winner IS NOT NULL
  `;
  return rows.map(toSettledBet);
}

/**
 * Only the bets where money is still owed.
 *
 * This is what "who owes who" runs on -- once the winner marks a bet paid it
 * drops off the tab but stays in the standings.
 */
export async function listUnpaidBets(): Promise<SettledBet[]> {
  const rows = await sql`
    SELECT id, proposer_id, taker_id, stake_cents, taker_stake_cents, winner
    FROM side_bets
    WHERE status = 'unpaid'
      AND taker_id IS NOT NULL
      AND winner IS NOT NULL
  `;
  return rows.map(toSettledBet);
}

function toSettledBet(r: any): SettledBet {
  return {
    id: r.id,
    proposerId: r.proposer_id,
    takerId: r.taker_id,
    stakeCents: r.stake_cents,
    takerStakeCents: r.taker_stake_cents,
    winner: r.winner,
  };
}

/** Bets a given person is involved in and still owes, or is still owed. */
export async function listMyOpenTabs(userId: number): Promise<SideBet[]> {
  const rows = await sql`
    SELECT b.id, b.season, b.week, b.proposer_id, b.taker_id, b.title,
           b.details, b.proposer_side, b.taker_side, b.stake_cents,
           b.taker_stake_cents, b.status, b.winner,
           b.market_kind, b.auto_settled, b.paid_at,
           p.display_name AS proposer_name,
           t.display_name AS taker_name
    FROM side_bets b
    JOIN users p ON p.id = b.proposer_id
    LEFT JOIN users t ON t.id = b.taker_id
    WHERE b.status = 'unpaid'
      AND (b.proposer_id = ${userId} OR b.taker_id = ${userId})
    ORDER BY b.season DESC, b.week DESC, b.created_at
  `;
  return rows.map(toSideBet);
}
