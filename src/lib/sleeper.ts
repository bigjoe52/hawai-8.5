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

/** Which of Sleeper's own points columns matches this league's format. */
export type ScoringFormat = "ppr" | "half_ppr" | "std";

export type LeagueScoring = {
  /** The league's own stat -> points multipliers, straight from Sleeper. */
  settings: Record<string, number>;
  /** Closest match among Sleeper's precomputed columns, used only as a fallback. */
  format: ScoringFormat;
};

/**
 * The league's actual scoring settings.
 *
 * This matters more than it sounds. Sleeper publishes precomputed `pts_ppr`,
 * `pts_half_ppr` and `pts_std` numbers, but those use *Sleeper's generic*
 * scoring, not yours. Any customisation -- 6-point passing touchdowns, TE
 * premium, yardage bonuses, a different penalty for interceptions -- makes
 * those numbers wrong for your league. The raw settings let us score the
 * projections ourselves.
 */
export async function getLeagueScoring(
  leagueId: string,
): Promise<SleeperResult<LeagueScoring>> {
  const res = await get<{ scoring_settings?: Record<string, number> | null }>(
    `/league/${leagueId}`,
  );
  if (!res.ok) return res;

  const settings = res.data.scoring_settings ?? {};
  const rec = settings.rec ?? 0;
  const format: ScoringFormat = rec >= 1 ? "ppr" : rec >= 0.5 ? "half_ppr" : "std";
  return { ok: true, data: { settings, format } };
}

const POSITIONS = ["QB", "RB", "WR", "TE", "K", "DEF"];

/**
 * Raw projected stats for every player in a week, keyed by player id.
 *
 * The values are Sleeper's stat projections -- `pass_yd`, `rec`, `rush_td` and
 * so on -- plus their precomputed `pts_*` columns. Scoring them is a separate
 * step so the league's own settings can be applied.
 */
export async function getProjections(
  season: string | number,
  week: number,
): Promise<SleeperResult<Map<string, Record<string, number>>>> {
  const query = [
    "season_type=regular",
    ...POSITIONS.map((p) => `position[]=${p}`),
    "order_by=ppr",
  ].join("&");

  const res = await get<unknown>(
    `/projections/nfl/${season}/${week}?${query}`,
    PROJECTIONS_BASE,
  );
  if (!res.ok) return res;

  const rows = parseProjections(res.data);
  if (rows.size === 0) {
    return { ok: false, error: "Sleeper returned no projections for this week." };
  }
  return { ok: true, data: rows };
}

/**
 * Turn whatever Sleeper sent into player id -> raw stat projections.
 * Exported for testing. Accepts an array of rows or an object keyed by id,
 * and skips anything it cannot read rather than throwing.
 */
export function parseProjections(
  payload: unknown,
): Map<string, Record<string, number>> {
  const out = new Map<string, Record<string, number>>();

  const read = (playerId: unknown, row: unknown) => {
    if (typeof playerId !== "string" || !row || typeof row !== "object") return;
    const raw = (row as { stats?: unknown }).stats;
    const source = (raw && typeof raw === "object" ? raw : row) as Record<
      string,
      unknown
    >;

    const stats: Record<string, number> = {};
    for (const [key, value] of Object.entries(source)) {
      if (typeof value === "number" && Number.isFinite(value)) stats[key] = value;
    }
    if (Object.keys(stats).length > 0) out.set(playerId, stats);
  };

  if (Array.isArray(payload)) {
    for (const row of payload) read((row as { player_id?: unknown })?.player_id, row);
  } else if (payload && typeof payload === "object") {
    for (const [playerId, row] of Object.entries(payload)) read(playerId, row);
  }

  return out;
}

/** How a player's points were arrived at, so the site can be honest about it. */
export type ScoringMethod = "league" | "generic";

export type PlayerPoints = { points: number; method: ScoringMethod };

/**
 * Score one player's projected stats.
 *
 * Preferred path: multiply each projected stat by this league's own multiplier
 * for it and add them up. Sleeper's scoring settings and its stat projections
 * use the same key names, so this is a straight dot product and it lands in
 * the league's actual scoring.
 *
 * Fallback: Sleeper's precomputed column for the league's format. Note this
 * never substitutes a *different* format -- a standard league falling back to
 * `pts_ppr` would read high by roughly the number of receptions.
 */
export function scorePlayer(
  stats: Record<string, number>,
  scoring: LeagueScoring,
): PlayerPoints | null {
  let total = 0;
  let matched = 0;

  for (const [stat, value] of Object.entries(stats)) {
    // The precomputed totals are not stats; adding them would double count.
    if (stat.startsWith("pts_")) continue;
    const multiplier = scoring.settings[stat];
    if (typeof multiplier === "number") {
      total += value * multiplier;
      matched += 1;
    }
  }

  // Deliberately unrounded: rounding each player before adding them up drifts
  // the team total by a few hundredths. The total is rounded once, at the end.
  if (matched > 0) return { points: total, method: "league" };

  // No usable stat projections -- fall back to Sleeper's own column, but only
  // the one that matches this league's format.
  const column =
    scoring.format === "ppr"
      ? "pts_ppr"
      : scoring.format === "half_ppr"
        ? "pts_half_ppr"
        : "pts_std";
  const precomputed = stats[column];
  if (typeof precomputed === "number") {
    return { points: precomputed, method: "generic" };
  }
  return null;
}

export type TeamProjection = { points: number; method: ScoringMethod };

/**
 * Add up each roster's projected score from its starting lineup.
 *
 * A lineup we can only price for a minority of its starters is left out
 * entirely -- a partial sum would read as a suspiciously low real projection
 * rather than as missing data.
 */
export function projectTeamScores(
  matchups: SleeperMatchup[],
  rows: Map<string, Record<string, number>>,
  scoring: LeagueScoring,
): Map<number, TeamProjection> {
  const totals = new Map<number, TeamProjection>();

  for (const m of matchups) {
    let total = 0;
    let found = 0;
    let generic = 0;

    for (const playerId of m.starters) {
      const stats = rows.get(playerId);
      if (!stats) continue;
      const scored = scorePlayer(stats, scoring);
      if (!scored) continue;
      total += scored.points;
      found += 1;
      if (scored.method === "generic") generic += 1;
    }

    if (found > 0 && found >= Math.ceil(m.starters.length / 2)) {
      totals.set(m.rosterId, {
        points: Math.round(total * 100) / 100,
        // If any starter fell back, the team total is only as good as that.
        method: generic > 0 ? "generic" : "league",
      });
    }
  }

  return totals;
}

/** Everything needed to build lines for a week, in one call. */
export async function getWeekProjections(
  leagueId: string,
  season: string | number,
  week: number,
): Promise<SleeperResult<Map<number, TeamProjection>>> {
  const [matchups, scoring] = await Promise.all([
    getMatchups(leagueId, week),
    getLeagueScoring(leagueId),
  ]);
  if (!matchups.ok) return matchups;
  if (!scoring.ok) return scoring;

  const projections = await getProjections(season, week);
  if (!projections.ok) return projections;

  const totals = projectTeamScores(matchups.data, projections.data, scoring.data);
  if (totals.size === 0) {
    return {
      ok: false,
      error:
        "Could not match any starters to Sleeper's projections. Lineups may not be set yet.",
    };
  }
  return { ok: true, data: totals };
}
