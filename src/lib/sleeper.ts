/**
 * Read-only client for the Sleeper API.
 *
 * Sleeper's public API needs no key, no OAuth, and no account -- you just GET
 * public JSON. It is also strictly READ-only: we can pull the league, rosters,
 * matchups and live scores, but we cannot push anything back into Sleeper.
 * That is why the bets themselves live in our own database, and Sleeper is
 * only the source of truth for what happened on the field.
 *
 * Every function here fails soft. If Sleeper is down, slow, or blocked by a
 * network policy, the site still loads -- the fantasy sections just show an
 * "unavailable" note instead of taking the whole page down with them.
 */

const BASE = "https://api.sleeper.app/v1";
const TIMEOUT_MS = 8000;

export type SleeperState = { season: string; week: number; seasonType: string };

export type SleeperUser = {
  userId: string;
  displayName: string;
  teamName: string | null;
  avatar: string | null;
};

export type SleeperRoster = {
  rosterId: number;
  ownerId: string | null;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
};

export type SleeperMatchup = {
  matchupId: number;
  rosterId: number;
  points: number;
};

/** Two rosters facing each other in a given week. */
export type HeadToHead = {
  matchupId: number;
  home: { rosterId: number; points: number; teamName: string; owner: string };
  away: { rosterId: number; points: number; teamName: string; owner: string };
};

export type SleeperResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

async function get<T>(path: string): Promise<SleeperResult<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE}${path}`, {
      signal: controller.signal,
      // Sleeper data changes fast during games; 60s is a reasonable middle
      // ground between live scores and hammering their API.
      next: { revalidate: 60 },
    });
    if (!res.ok) {
      return { ok: false, error: `Sleeper returned HTTP ${res.status} for ${path}` };
    }
    const data = (await res.json()) as T;
    if (data === null) {
      return { ok: false, error: `Sleeper returned no data for ${path}` };
    }
    return { ok: true, data };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      error: `Could not reach Sleeper (${reason}). The rest of the site still works.`,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Current NFL season and week, straight from Sleeper. */
export async function getNflState(): Promise<SleeperResult<SleeperState>> {
  const res = await get<{ season: string; week: number; season_type: string }>(
    "/state/nfl",
  );
  if (!res.ok) return res;
  return {
    ok: true,
    data: {
      season: res.data.season,
      week: res.data.week,
      seasonType: res.data.season_type,
    },
  };
}

export async function getLeagueUsers(
  leagueId: string,
): Promise<SleeperResult<SleeperUser[]>> {
  const res = await get<
    Array<{
      user_id: string;
      display_name: string;
      avatar: string | null;
      metadata?: { team_name?: string } | null;
    }>
  >(`/league/${leagueId}/users`);
  if (!res.ok) return res;
  return {
    ok: true,
    data: res.data.map((u) => ({
      userId: u.user_id,
      displayName: u.display_name,
      teamName: u.metadata?.team_name ?? null,
      avatar: u.avatar,
    })),
  };
}

export async function getRosters(
  leagueId: string,
): Promise<SleeperResult<SleeperRoster[]>> {
  const res = await get<
    Array<{
      roster_id: number;
      owner_id: string | null;
      settings?: {
        wins?: number;
        losses?: number;
        ties?: number;
        fpts?: number;
        fpts_decimal?: number;
      } | null;
    }>
  >(`/league/${leagueId}/rosters`);
  if (!res.ok) return res;
  return {
    ok: true,
    data: res.data.map((r) => ({
      rosterId: r.roster_id,
      ownerId: r.owner_id,
      wins: r.settings?.wins ?? 0,
      losses: r.settings?.losses ?? 0,
      ties: r.settings?.ties ?? 0,
      // Sleeper splits points into whole and decimal parts.
      pointsFor:
        (r.settings?.fpts ?? 0) + (r.settings?.fpts_decimal ?? 0) / 100,
    })),
  };
}

export async function getMatchups(
  leagueId: string,
  week: number,
): Promise<SleeperResult<SleeperMatchup[]>> {
  const res = await get<
    Array<{ matchup_id: number | null; roster_id: number; points: number | null }>
  >(`/league/${leagueId}/matchups/${week}`);
  if (!res.ok) return res;
  return {
    ok: true,
    data: res.data
      // A null matchup_id means that roster has a bye this week.
      .filter((m) => m.matchup_id !== null)
      .map((m) => ({
        matchupId: m.matchup_id as number,
        rosterId: m.roster_id,
        points: m.points ?? 0,
      })),
  };
}

/**
 * Sleeper returns matchups as a flat list where two rows sharing a matchup_id
 * are playing each other. This pairs them up and attaches human names, which
 * is the shape the side-bet UI actually wants.
 */
export function pairMatchups(
  matchups: SleeperMatchup[],
  rosters: SleeperRoster[],
  users: SleeperUser[],
): HeadToHead[] {
  const rosterById = new Map(rosters.map((r) => [r.rosterId, r]));
  const userById = new Map(users.map((u) => [u.userId, u]));

  const describe = (rosterId: number, points: number) => {
    const roster = rosterById.get(rosterId);
    const owner = roster?.ownerId ? userById.get(roster.ownerId) : undefined;
    return {
      rosterId,
      points,
      teamName: owner?.teamName ?? owner?.displayName ?? `Roster ${rosterId}`,
      owner: owner?.displayName ?? "Unknown",
    };
  };

  const grouped = new Map<number, SleeperMatchup[]>();
  for (const m of matchups) {
    const list = grouped.get(m.matchupId) ?? [];
    list.push(m);
    grouped.set(m.matchupId, list);
  }

  const out: HeadToHead[] = [];
  for (const [matchupId, sides] of grouped) {
    // A well-formed matchup has exactly two sides. Skip anything else rather
    // than rendering half a game.
    if (sides.length !== 2) continue;
    const [a, b] = sides;
    out.push({
      matchupId,
      home: describe(a.rosterId, a.points),
      away: describe(b.rosterId, b.points),
    });
  }

  return out.sort((x, y) => x.matchupId - y.matchupId);
}

/** Everything the side-bet page needs, in one call, with a single failure path. */
export async function getWeekMatchups(
  leagueId: string,
  week: number,
): Promise<SleeperResult<HeadToHead[]>> {
  const [matchups, rosters, users] = await Promise.all([
    getMatchups(leagueId, week),
    getRosters(leagueId),
    getLeagueUsers(leagueId),
  ]);
  if (!matchups.ok) return matchups;
  if (!rosters.ok) return rosters;
  if (!users.ok) return users;
  return { ok: true, data: pairMatchups(matchups.data, rosters.data, users.data) };
}
