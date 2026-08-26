import { test } from "node:test";
import assert from "node:assert/strict";
import {
  pairMatchups,
  type SleeperMatchup,
  type SleeperRoster,
  type SleeperUser,
} from "../src/lib/sleeper.ts";

const rosters: SleeperRoster[] = [
  { rosterId: 1, ownerId: "u1", wins: 3, losses: 1, ties: 0, pointsFor: 400.5 },
  { rosterId: 2, ownerId: "u2", wins: 2, losses: 2, ties: 0, pointsFor: 380.2 },
  { rosterId: 3, ownerId: "u3", wins: 1, losses: 3, ties: 0, pointsFor: 350.0 },
  { rosterId: 4, ownerId: null, wins: 0, losses: 4, ties: 0, pointsFor: 300.0 },
];

const users: SleeperUser[] = [
  { userId: "u1", displayName: "joe", teamName: "Big Kahunas", avatar: null },
  { userId: "u2", displayName: "mike", teamName: null, avatar: null },
  { userId: "u3", displayName: "dave", teamName: "Wipeout", avatar: null },
];

const m = (
  matchupId: number,
  rosterId: number,
  points: number,
  starters: string[] = [],
): SleeperMatchup => ({ matchupId, rosterId, points, starters });

test("pairs the two rosters that share a matchup id", () => {
  const games = pairMatchups([m(1, 1, 110.5), m(1, 2, 98.2)], rosters, users);
  assert.equal(games.length, 1);
  assert.equal(games[0].home.rosterId, 1);
  assert.equal(games[0].away.rosterId, 2);
  assert.equal(games[0].home.points, 110.5);
});

test("prefers the team name, falls back to the display name", () => {
  const games = pairMatchups([m(1, 1, 100), m(1, 2, 90)], rosters, users);
  assert.equal(games[0].home.teamName, "Big Kahunas"); // has a team name
  assert.equal(games[0].away.teamName, "mike"); // no team name set
  assert.equal(games[0].away.owner, "mike");
});

test("an orphaned roster still renders instead of crashing", () => {
  // Roster 4 has no owner -- a real thing that happens in Sleeper leagues.
  const games = pairMatchups([m(1, 3, 100), m(1, 4, 90)], rosters, users);
  assert.equal(games[0].away.teamName, "Roster 4");
  assert.equal(games[0].away.owner, "Unknown");
});

test("a roster nobody knows about does not blow up", () => {
  const games = pairMatchups([m(1, 99, 100), m(1, 98, 90)], rosters, users);
  assert.equal(games.length, 1);
  assert.equal(games[0].home.teamName, "Roster 99");
});

test("half a matchup is skipped rather than rendered", () => {
  // One side missing => not a game, don't show it.
  assert.deepEqual(pairMatchups([m(1, 1, 100)], rosters, users), []);
  // Three sides sharing an id is malformed data => skip it too.
  assert.deepEqual(
    pairMatchups([m(1, 1, 1), m(1, 2, 2), m(1, 3, 3)], rosters, users),
    [],
  );
});

test("multiple games come back sorted by matchup id", () => {
  const games = pairMatchups(
    [m(2, 3, 80), m(1, 1, 100), m(2, 4, 70), m(1, 2, 90)],
    rosters,
    users,
  );
  assert.deepEqual(
    games.map((g) => g.matchupId),
    [1, 2],
  );
});

test("an empty week yields no games", () => {
  assert.deepEqual(pairMatchups([], rosters, users), []);
});

/* --- Projections ---------------------------------------------------------- */

import {
  parseProjections,
  scorePlayer,
  projectTeamScores,
  type LeagueScoring,
} from "../src/lib/sleeper.ts";

/** A fairly ordinary PPR league. */
const PPR: LeagueScoring = {
  format: "ppr",
  settings: {
    pass_yd: 0.04, pass_td: 4, pass_int: -2,
    rush_yd: 0.1, rush_td: 6,
    rec: 1, rec_yd: 0.1, rec_td: 6,
    fum_lost: -2,
  },
};

/** Same league on standard scoring -- no points per reception. */
const STD: LeagueScoring = {
  format: "std",
  settings: { ...PPR.settings, rec: 0 },
};

/** A customised league: 6-point passing TDs and TE premium. */
const CUSTOM: LeagueScoring = {
  format: "ppr",
  settings: { ...PPR.settings, pass_td: 6, bonus_rec_te: 0.5 },
};

test("parseProjections keeps the raw stat lines", () => {
  const rows = parseProjections([
    { player_id: "4046", stats: { pass_yd: 275, pass_td: 2, pass_int: 0.6 } },
  ]);
  assert.deepEqual(rows.get("4046"), { pass_yd: 275, pass_td: 2, pass_int: 0.6 });
});

test("parseProjections reads an object keyed by player id", () => {
  const rows = parseProjections({ "4046": { stats: { rec: 5, rec_yd: 60 } } });
  assert.deepEqual(rows.get("4046"), { rec: 5, rec_yd: 60 });
});

test("parseProjections reads stats at the top level too", () => {
  assert.deepEqual(parseProjections([{ player_id: "9", rec: 4 }]).get("9"), { rec: 4 });
});

test("parseProjections drops non-numeric values and empty rows", () => {
  const rows = parseProjections([
    { player_id: "a", stats: { rec: 4, name: "Somebody", hurt: null } },
    { player_id: "b", stats: { name: "All text" } },
    { player_id: 5, stats: { rec: 4 } },
    null,
  ]);
  assert.deepEqual(rows.get("a"), { rec: 4 });
  assert.equal(rows.has("b"), false);
  assert.equal(rows.size, 1);
});

test("parseProjections survives junk without throwing", () => {
  for (const junk of [null, undefined, 42, "text", [], {}]) {
    assert.equal(parseProjections(junk).size, 0);
  }
});

test("a player is scored with the league's own settings", () => {
  // 275 pass yd, 2 pass TD, 1 INT = 11 + 8 - 2 = 17
  const scored = scorePlayer({ pass_yd: 275, pass_td: 2, pass_int: 1 }, PPR);
  assert.equal(scored?.points, 17);
  assert.equal(scored?.method, "league");
});

test("standard scoring does NOT quietly borrow PPR numbers", () => {
  // This was the bug: a standard league falling back to pts_ppr read high by
  // roughly one point per reception.
  const stats = { rec: 8, rec_yd: 90, rec_td: 1, pts_ppr: 23, pts_half_ppr: 19 };
  const ppr = scorePlayer(stats, PPR)!;
  const std = scorePlayer(stats, STD)!;
  assert.equal(ppr.points, 23); // 8 + 9 + 6
  assert.equal(std.points, 15); // 0 + 9 + 6
  assert.equal(ppr.points - std.points, 8, "the difference is exactly the receptions");
});

test("custom scoring is respected rather than assumed", () => {
  const stats = { pass_yd: 300, pass_td: 3 };
  // Generic league: 12 + 12 = 24. Custom 6-point passing TDs: 12 + 18 = 30.
  assert.equal(scorePlayer(stats, PPR)?.points, 24);
  assert.equal(scorePlayer(stats, CUSTOM)?.points, 30);
});

test("precomputed totals never get added on top of the stats", () => {
  // pts_ppr sitting alongside the stats must not double count.
  const withTotals = scorePlayer({ rec: 5, rec_yd: 50, pts_ppr: 10 }, PPR)!;
  const without = scorePlayer({ rec: 5, rec_yd: 50 }, PPR)!;
  assert.equal(withTotals.points, without.points);
  assert.equal(withTotals.points, 10);
});

test("stats the league does not score are ignored", () => {
  // Sleeper sends plenty of stats a league assigns no value to.
  const scored = scorePlayer({ rec: 5, rec_yd: 50, snaps: 62, targets: 9 }, PPR)!;
  assert.equal(scored.points, 10);
});

test("falls back to Sleeper's own column only when there are no usable stats", () => {
  const scored = scorePlayer({ pts_ppr: 14.2, pts_half_ppr: 11.7, pts_std: 9.2 }, PPR)!;
  assert.equal(scored.points, 14.2);
  assert.equal(scored.method, "generic");
});

test("the fallback picks the column matching the league's format", () => {
  const stats = { pts_ppr: 14.2, pts_half_ppr: 11.7, pts_std: 9.2 };
  assert.equal(scorePlayer(stats, STD)?.points, 9.2);
  assert.equal(scorePlayer(stats, { ...PPR, format: "half_ppr" })?.points, 11.7);
});

test("the fallback does not substitute a different format", () => {
  // A standard league with only pts_ppr available gets nothing, rather than an
  // inflated number quietly presented as its own.
  assert.equal(scorePlayer({ pts_ppr: 20 }, STD), null);
});

test("a player with nothing usable scores null", () => {
  assert.equal(scorePlayer({}, PPR), null);
  assert.equal(scorePlayer({ snaps: 60 }, PPR), null);
});

test("negative scoring works (turnovers cost points)", () => {
  const scored = scorePlayer({ pass_yd: 250, pass_int: 3, fum_lost: 1 }, PPR)!;
  assert.equal(scored.points, 10 - 6 - 2);
});

const lineup = (rosterId: number, starters: string[]): SleeperMatchup => ({
  matchupId: 1,
  rosterId,
  points: 0,
  starters,
});

test("a team total is its starters scored in league settings", () => {
  const rows = new Map<string, Record<string, number>>([
    ["a", { rec: 6, rec_yd: 80 }],   // 14
    ["b", { rush_yd: 90, rush_td: 1 }], // 15
    ["c", { pass_yd: 300, pass_td: 2 }], // 20
  ]);
  const totals = projectTeamScores([lineup(1, ["a", "b", "c"])], rows, PPR);
  assert.equal(totals.get(1)?.points, 49);
  assert.equal(totals.get(1)?.method, "league");
});

test("the same lineup scores lower in a standard league", () => {
  const rows = new Map([
    ["a", { rec: 6, rec_yd: 80 }],
    ["b", { rec: 4, rec_yd: 50 }],
  ]);
  const ppr = projectTeamScores([lineup(1, ["a", "b"])], rows, PPR).get(1)!;
  const std = projectTeamScores([lineup(1, ["a", "b"])], rows, STD).get(1)!;
  assert.equal(ppr.points - std.points, 10, "ten receptions, ten points");
});

test("a team flagged generic when any starter fell back", () => {
  const rows = new Map<string, Record<string, number>>([
    ["a", { rec: 6, rec_yd: 80 }],
    ["b", { pts_ppr: 12 }],
  ]);
  assert.equal(projectTeamScores([lineup(1, ["a", "b"])], rows, PPR).get(1)?.method, "generic");
});

test("a mostly-unknown lineup is left off entirely", () => {
  const rows = new Map([["a", { rec: 6 }]]);
  const totals = projectTeamScores([lineup(1, ["a", "v", "w", "x", "y"])], rows, PPR);
  assert.equal(totals.has(1), false);
});

test("an empty lineup produces no projection rather than zero", () => {
  assert.equal(projectTeamScores([lineup(1, [])], new Map(), PPR).has(1), false);
});

test("team totals are rounded to cents, not left as float noise", () => {
  const rows = new Map([
    ["a", { rec_yd: 83 }],
    ["b", { rec_yd: 47 }],
  ]);
  const total = projectTeamScores([lineup(1, ["a", "b"])], rows, PPR).get(1)!.points;
  assert.equal(total, 13);
  assert.ok(Number.isInteger(total * 100));
});

test("a realistic PPR lineup lands in a believable range", () => {
  // Nine starters with ordinary stat lines should total roughly 100-140,
  // not 200. If this ever fails, the scoring is double counting something.
  const starter = { rec: 4, rec_yd: 55, rush_yd: 20, rec_td: 0.4 };
  const rows = new Map(
    Array.from({ length: 9 }, (_, i) => [`p${i}`, starter] as const),
  );
  const total = projectTeamScores(
    [lineup(1, Array.from({ length: 9 }, (_, i) => `p${i}`))],
    rows,
    PPR,
  ).get(1)!.points;
  assert.ok(total > 90 && total < 150, `${total} is not a believable team total`);
});

test("rounding happens once, at the team total, not per player", () => {
  // Nine identical players each worth 12.344 points. Rounding each to cents
  // first would drift the total; rounding once keeps it exact.
  const stats = { rec_yd: 123.44 }; // 12.344 points at 0.1/yd
  const rows = new Map(
    Array.from({ length: 9 }, (_, i) => [`p${i}`, stats] as const),
  );
  const total = projectTeamScores(
    [lineup(1, Array.from({ length: 9 }, (_, i) => `p${i}`))],
    rows,
    PPR,
  ).get(1)!.points;
  // 9 x 12.344 = 111.096 -> 111.1
  assert.equal(total, 111.1);
});

test("a single player's points are not pre-rounded away", () => {
  const scored = scorePlayer({ rec_yd: 123.44 }, PPR)!;
  assert.ok(Math.abs(scored.points - 12.344) < 1e-9, `${scored.points}`);
});
