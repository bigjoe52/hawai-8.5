import { sql } from "./db.ts";
import type { LegStatus } from "./odds.ts";
import type { SettledBet } from "./ledger.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */

export type LeagueMember = {
  id: number;
  username: string;
  displayName: string;
  isAdmin: boolean;
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
  stakePerUserCents: number;
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
  status: "open" | "matched" | "settled" | "void";
  winner: "proposer" | "taker" | "push" | null;
};

export async function listMembers(): Promise<LeagueMember[]> {
  const rows = await sql`
    SELECT id, username, display_name, is_admin
    FROM users ORDER BY display_name
  `;
  return rows.map((r: any) => ({
    id: r.id,
    username: r.username,
    displayName: r.display_name,
    isAdmin: r.is_admin,
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
    stake_per_user_cents: number;
    notes: string | null;
  }>`
    SELECT id, season, week, status, stake_per_user_cents, notes
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
    stakePerUserCents: parlay.stake_per_user_cents,
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
    status: r.status,
    winner: r.winner,
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
           b.status, b.winner,
           p.display_name AS proposer_name,
           t.display_name AS taker_name
    FROM side_bets b
    JOIN users p ON p.id = b.proposer_id
    LEFT JOIN users t ON t.id = b.taker_id
    WHERE b.season = ${season} AND b.week = ${week}
    ORDER BY
      CASE b.status WHEN 'open' THEN 0 WHEN 'matched' THEN 1 ELSE 2 END,
      b.created_at DESC
  `;
  return rows.map(toSideBet);
}

/** Bets that are matched but not yet graded -- the commissioner's to-do list. */
export async function listUnsettledBets(): Promise<SideBet[]> {
  const rows = await sql`
    SELECT b.id, b.season, b.week, b.proposer_id, b.taker_id, b.title,
           b.details, b.proposer_side, b.taker_side, b.stake_cents,
           b.status, b.winner,
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
 * Every graded bet, in the shape the ledger math wants.
 *
 * Pushes are included even though they are stored as 'void' -- they move no
 * money, but they still belong in a player's record, so the standings can show
 * a push column. `netByUser` skips them when totalling cash.
 */
export async function listSettledBets(): Promise<SettledBet[]> {
  const rows = await sql`
    SELECT id, proposer_id, taker_id, stake_cents, winner
    FROM side_bets
    WHERE status IN ('settled', 'void')
      AND taker_id IS NOT NULL
      AND winner IS NOT NULL
  `;
  return rows.map((r: any) => ({
    id: r.id,
    proposerId: r.proposer_id,
    takerId: r.taker_id,
    stakeCents: r.stake_cents,
    winner: r.winner,
  }));
}
