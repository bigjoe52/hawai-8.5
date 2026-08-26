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

// Overridable so the app can be pointed at a stand-in during development;
// unset in normal use, which is what production runs on.
const BASE = process.env.SLEEPER_API_BASE ?? "https://api.sleeper.app/v1";
// Projections live on a different host from the rest of the API.
const PROJECTIONS_BASE =
  process.env.SLEEPER_PROJECTIONS_BASE ?? "https://api.sleeper.com";
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
  /** Player ids in the starting lineup. Empty slots are filtered out. */
  starters: string[];
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

async function get<T>(path: string, base: string = BASE): Promise<SleeperResult<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${base}${path}`, {
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
    Array<{
      matchup_id: number | null;
      roster_id: number;
      points: number | null;
      starters: string[] | null;
    }>
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
        // "0" is Sleeper's placeholder for an unfilled roster slot.
        starters: (m.starters ?? []).filter((id) => id && id !== "0"),
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

/* ---------------------------------------------------------------------------
 * Projections
 * ------------------------------------------------------------------------ */

/** Which points column to read: PPR, half-PPR, or standard. */
export type ScoringFormat = "ppr" | "half_ppr" | "std";

/**
 * Work out the league's scoring format from its settings.
 * `rec` is points per reception: 1 = PPR, 0.5 = half, 0 (or absent) = standard.
 */
export async function getLeagueScoring(
  leagueId: string,
): Promise<SleeperResult<ScoringFormat>> {
  const res = await get<{ scoring_settings?: Record<string, number> | null }>(
    `/league/${leagueId}`,
  );
  if (!res.ok) return res;
  const rec = res.data.scoring_settings?.rec ?? 0;
  const format: ScoringFormat = rec >= 1 ? "ppr" : rec >= 0.5 ? "half_ppr" : "std";
  return { ok: true, data: format };
}

const POSITIONS = ["QB", "RB", "WR", "TE", "K", "DEF"];

/**
 * Projected points for every player in a given week, keyed by player id.
 *
 * Sleeper's projections endpoint is not part of their documented v1 API and
 * has been known to change shape, so the parsing below accepts either an array
 * of rows or an object keyed by player id, and skips anything it can't read
 * rather than throwing.
 */
export async function getProjections(
  season: string | number,
  week: number,
  format: ScoringFormat,
): Promise<SleeperResult<Map<string, number>>> {
  const query = [
    "season_type=regular",
    ...POSITIONS.map((p) => `position[]=${p}`),
    `order_by=${format}`,
  ].join("&");

  const res = await get<unknown>(
    `/projections/nfl/${season}/${week}?${query}`,
    PROJECTIONS_BASE,
  );
  if (!res.ok) return res;

  const points = parseProjections(res.data, format);
  if (points.size === 0) {
    return {
      ok: false,
      error: "Sleeper returned no projections for this week.",
    };
  }
  return { ok: true, data: points };
}

/** Exported for testing: turn whatever Sleeper sent into player id -> points. */
export function parseProjections(
  payload: unknown,
  format: ScoringFormat,
): Map<string, number> {
  const key = format === "ppr" ? "pts_ppr" : format === "half_ppr" ? "pts_half_ppr" : "pts_std";
  const out = new Map<string, number>();

  const read = (playerId: unknown, row: unknown) => {
    if (typeof playerId !== "string" || !row || typeof row !== "object") return;
    const stats = (row as { stats?: unknown }).stats;
    const source = (stats && typeof stats === "object" ? stats : row) as Record<
      string,
      unknown
    >;
    // Fall back through the formats: a league on half-PPR still wants a number
    // if only pts_ppr came back.
    const value =
      source[key] ?? source.pts_half_ppr ?? source.pts_ppr ?? source.pts_std;
    if (typeof value === "number" && Number.isFinite(value)) {
      out.set(playerId, value);
    }
  };

  if (Array.isArray(payload)) {
    for (const row of payload) {
      read((row as { player_id?: unknown })?.player_id, row);
    }
  } else if (payload && typeof payload === "object") {
    for (const [playerId, row] of Object.entries(payload)) read(playerId, row);
  }

  return out;
}

/**
 * Add up each roster's projected score from its starting lineup.
 * Rosters whose starters are all missing from the projection set are left out
 * rather than reported as a projected zero.
 */
export function projectTeamScores(
  matchups: SleeperMatchup[],
  projections: Map<string, number>,
): Map<number, number> {
  const totals = new Map<number, number>();
  for (const m of matchups) {
    let total = 0;
    let found = 0;
    for (const playerId of m.starters) {
      const points = projections.get(playerId);
      if (typeof points === "number") {
        total += points;
        found += 1;
      }
    }
    // Require at least half the lineup, otherwise the number is meaningless.
    if (found > 0 && found >= Math.ceil(m.starters.length / 2)) {
      totals.set(m.rosterId, Math.round(total * 100) / 100);
    }
  }
  return totals;
}

/** Everything needed to build lines for a week, in one call. */
export async function getWeekProjections(
  leagueId: string,
  season: string | number,
  week: number,
): Promise<SleeperResult<Map<number, number>>> {
  const [matchups, scoring] = await Promise.all([
    getMatchups(leagueId, week),
    getLeagueScoring(leagueId),
  ]);
  if (!matchups.ok) return matchups;
  if (!scoring.ok) return scoring;

  const projections = await getProjections(season, week, scoring.data);
  if (!projections.ok) return projections;

  const totals = projectTeamScores(matchups.data, projections.data);
  if (totals.size === 0) {
    return {
      ok: false,
      error:
        "Could not match any starters to Sleeper's projections. Lineups may not be set yet.",
    };
  }
  return { ok: true, data: totals };
}
