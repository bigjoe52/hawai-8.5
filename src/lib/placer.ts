import { sql } from "./db.ts";
import { getMatchups, getRosters } from "./sleeper.ts";
import { currentWeek } from "./week.ts";

/**
 * Who has to place the parlay.
 *
 * The rule: whoever scored lowest in week N places week N+1's ticket. Week 1
 * has nobody to punish yet, so it is set by hand.
 *
 * The answer is cached on the parlay row once it is known, so the site keeps
 * showing the right name even if Sleeper is unreachable later.
 */

export type Placer = {
  userId: number | null;
  displayName: string | null;
  /** How we arrived at it, so the page can explain itself. */
  reason: string;
  /** True only in week 1, which genuinely has no previous week to judge. */
  isFirstWeek: boolean;
  /** What they scored to earn it, and in which week. Null in week 1. */
  points: number | null;
  fromWeek: number | null;
};

/** Week 1's placer, by username. Set LEAGUE_FIRST_PLACER to change it. */
const FIRST_PLACER = process.env.LEAGUE_FIRST_PLACER ?? "biz";

export async function resolvePlacer(
  season: number,
  week: number,
): Promise<Placer> {
  // Already worked out? Use it -- the answer never changes once the week is done.
  const [cached] = await sql<{ placer_user_id: number | null; display_name: string | null }>`
    SELECT p.placer_user_id, u.display_name
    FROM parlays p
    LEFT JOIN users u ON u.id = p.placer_user_id
    WHERE p.season = ${season} AND p.week = ${week}
  `;
  if (cached?.placer_user_id) {
    // Re-read the score only to caption the cached PERSON, and only use it if
    // it is still the same person. Otherwise the banner shows one member's
    // name beside another member's score.
    let points: number | null = null;
    if (week > 1) {
      const current = await lowestScorer(week - 1);
      if (current && current.userId === cached.placer_user_id) {
        points = current.points;
      }
    }
    return {
      userId: cached.placer_user_id,
      displayName: cached.display_name,
      reason: week === 1 ? "set for week 1" : `came last in week ${week - 1}`,
      points,
      fromWeek: week > 1 ? week - 1 : null,
      isFirstWeek: week === 1,
    };
  }

  if (week === 1) {
    const [user] = await sql<{ id: number; display_name: string }>`
      SELECT id, display_name FROM users
      WHERE lower(username) = lower(${FIRST_PLACER})
    `;
    if (!user) {
      return {
        userId: null,
        displayName: null,
        reason: `no member called "${FIRST_PLACER}" — set LEAGUE_FIRST_PLACER`,
        points: null,
        fromWeek: null,
        isFirstWeek: true,
      };
    }
    await cachePlacer(season, week, user.id);
    return {
      userId: user.id,
      displayName: user.display_name,
      reason: "set for week 1",
      points: null,
      fromWeek: null,
      isFirstWeek: true,
    };
  }

  // Only judge a week that has finished. Otherwise loading next week's page on
  // a Sunday afternoon brands whoever is temporarily last -- with most teams
  // yet to play -- and the answer is then cached permanently.
  const { week: liveWeek } = currentWeek();
  if (week - 1 >= liveWeek) {
    return {
      userId: null,
      displayName: null,
      reason: `week ${week - 1} is still being played`,
      points: null,
      fromWeek: week - 1,
      isFirstWeek: false,
    };
  }

  const loser = await lowestScorer(week - 1);
  if (!loser) {
    return {
      userId: null,
      displayName: null,
      reason: `week ${week - 1} isn't final yet`,
      points: null,
      fromWeek: week - 1,
      isFirstWeek: false,
    };
  }

  await cachePlacer(season, week, loser.userId);
  return {
    userId: loser.userId,
    displayName: loser.displayName,
    reason: `came last in week ${week - 1}`,
    points: loser.points,
    fromWeek: week - 1,
    isFirstWeek: false,
  };
}

/** The member who scored fewest points in a given week. */
export async function lowestScorer(
  week: number,
): Promise<{ userId: number; displayName: string; points: number } | null> {
  const leagueId = process.env.SLEEPER_LEAGUE_ID;
  if (!leagueId) return null;

  const [matchups, rosters] = await Promise.all([
    getMatchups(leagueId, week),
    getRosters(leagueId),
  ]);
  if (!matchups.ok || !rosters.ok) return null;

  // A week nobody has played yet is all zeroes; there is no last place in that.
  const played = matchups.data.filter((m) => m.points > 0);
  if (played.length === 0) return null;

  const ownerByRoster = new Map(
    rosters.data.map((r) => [r.rosterId, r.ownerId]),
  );

  // Walk from the lowest score upwards and take the first roster whose owner is
  // actually linked to a member. Picking the league-wide lowest and then
  // failing when that one person is unlinked meant nine of ten linked still
  // produced no bum.
  const candidates = played
    .map((m) => ({ ownerId: ownerByRoster.get(m.rosterId), points: m.points }))
    .filter((c): c is { ownerId: string; points: number } => Boolean(c.ownerId))
    .sort((a, b) => a.points - b.points);

  for (const candidate of candidates) {
    const [user] = await sql<{ id: number; display_name: string }>`
      SELECT id, display_name FROM users WHERE sleeper_user_id = ${candidate.ownerId}
    `;
    if (user) {
      return {
        userId: user.id,
        displayName: user.display_name,
        points: candidate.points,
      };
    }
  }
  return null;
}

async function cachePlacer(season: number, week: number, userId: number) {
  await sql`
    UPDATE parlays SET placer_user_id = ${userId}
    WHERE season = ${season} AND week = ${week} AND placer_user_id IS NULL
  `;
}
