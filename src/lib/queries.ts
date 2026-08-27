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

export type ParlayRecord = {
  season: number;
  week: number;
  status: "open" | "locked" | "won" | "lost";
  stakeCents: number;
  legCount: number;
  wonLegs: number;
  lostLegs: number;
  pendingLegs: number;
  /** American odds of every graded leg, for the combined price. */
  legOdds: number[];
  /** Whoever's leg killed it. Usually one, occasionally more. */
  bustedBy: string[];
  placerName: string | null;
};

/**
 * Every week's parlay, newest first.
 *
 * One row per week with enough detail to show the ticket's story: how many
 * legs, how it finished, what it paid, and whose leg ended it.
 */
export async function listParlayHistory(): Promise<ParlayRecord[]> {
  const rows = await sql`
    SELECT
      p.season, p.week, p.status, p.stake_cents,
      u.display_name AS placer_name,
      COUNT(l.id)::int AS leg_count,
      COUNT(l.id) FILTER (WHERE l.status = 'win')::int     AS won_legs,
      COUNT(l.id) FILTER (WHERE l.status = 'loss')::int    AS lost_legs,
      COUNT(l.id) FILTER (WHERE l.status = 'pending')::int AS pending_legs,
      COALESCE(
        array_agg(l.odds_american ORDER BY l.created_at)
          FILTER (WHERE l.id IS NOT NULL),
        ARRAY[]::int[]
      ) AS leg_odds,
      COALESCE(
        array_agg(DISTINCT lu.display_name) FILTER (WHERE l.status = 'loss'),
        ARRAY[]::text[]
      ) AS busted_by
    FROM parlays p
    LEFT JOIN parlay_legs l ON l.parlay_id = p.id
    LEFT JOIN users lu ON lu.id = l.user_id
    LEFT JOIN users u ON u.id = p.placer_user_id
    GROUP BY p.id, p.season, p.week, p.status, p.stake_cents, u.display_name
    ORDER BY p.season DESC, p.week DESC
  `;

  return rows.map((r: any) => ({
    season: r.season,
    week: r.week,
    status: r.status,
    stakeCents: r.stake_cents,
    legCount: r.leg_count,
    wonLegs: r.won_legs,
    lostLegs: r.lost_legs,
    pendingLegs: r.pending_legs,
    legOdds: (r.leg_odds ?? []).map(Number),
    bustedBy: r.busted_by ?? [],
    placerName: r.placer_name,
  }));
}

export type LegRecord = {
  userId: number;
  displayName: string;
  wins: number;
  losses: number;
  pushes: number;
  pending: number;
  /**
   * Weeks this player's leg lost when it was the ONLY leg that lost -- so the
   * ticket was alive until they, personally, ended it. The roasting stat.
   */
  soloBusts: number;
};

/**
 * Each member's season record on their parlay legs.
 *
 * Nobody expects to hit a ten-leg parlay; the point is the running record, so
 * this counts every leg a person has put in and how often theirs was the one
 * that killed an otherwise-live ticket.
 *
 * Everyone appears, including members who have not submitted a leg yet.
 */
export async function listLegRecords(): Promise<LegRecord[]> {
  const rows = await sql`
    SELECT
      u.id AS user_id,
      u.display_name,
      COUNT(l.id) FILTER (WHERE l.status = 'win')::int     AS wins,
      COUNT(l.id) FILTER (WHERE l.status = 'loss')::int    AS losses,
      COUNT(l.id) FILTER (WHERE l.status = 'push')::int    AS pushes,
      COUNT(l.id) FILTER (WHERE l.status = 'pending')::int AS pending,
      COUNT(l.id) FILTER (
        WHERE l.status = 'loss'
          AND (
            SELECT COUNT(*) FROM parlay_legs sib
            WHERE sib.parlay_id = l.parlay_id AND sib.status = 'loss'
          ) = 1
      )::int AS solo_busts
    FROM users u
    LEFT JOIN parlay_legs l ON l.user_id = u.id
    GROUP BY u.id, u.display_name
    ORDER BY u.display_name
  `;

  return rows.map((r: any) => ({
    userId: r.user_id,
    displayName: r.display_name,
    wins: r.wins,
    losses: r.losses,
    pushes: r.pushes,
    pending: r.pending,
    soloBusts: r.solo_busts,
  }));
}
