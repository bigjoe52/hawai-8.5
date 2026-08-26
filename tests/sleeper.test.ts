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

import { parseProjections, projectTeamScores } from "../src/lib/sleeper.ts";

test("parses the array shape Sleeper returns", () => {
  const points = parseProjections(
    [
      { player_id: "4046", stats: { pts_ppr: 18.4, pts_half_ppr: 15.9, pts_std: 13.4 } },
      { player_id: "6794", stats: { pts_ppr: 12.1, pts_half_ppr: 10.6, pts_std: 9.1 } },
    ],
    "ppr",
  );
  assert.equal(points.get("4046"), 18.4);
  assert.equal(points.get("6794"), 12.1);
});

test("reads the right column for each scoring format", () => {
  const row = [{ player_id: "1", stats: { pts_ppr: 20, pts_half_ppr: 17, pts_std: 14 } }];
  assert.equal(parseProjections(row, "ppr").get("1"), 20);
  assert.equal(parseProjections(row, "half_ppr").get("1"), 17);
  assert.equal(parseProjections(row, "std").get("1"), 14);
});

test("parses an object keyed by player id too", () => {
  const points = parseProjections({ "4046": { stats: { pts_ppr: 18.4 } } }, "ppr");
  assert.equal(points.get("4046"), 18.4);
});

test("handles stats living at the top level rather than under .stats", () => {
  assert.equal(parseProjections([{ player_id: "9", pts_ppr: 11.5 }], "ppr").get("9"), 11.5);
});

test("falls back to another format when the requested one is absent", () => {
  // A half-PPR league still wants a number if only pts_ppr came back.
  assert.equal(parseProjections([{ player_id: "1", stats: { pts_ppr: 20 } }], "half_ppr").get("1"), 20);
});

test("skips malformed rows instead of throwing", () => {
  const points = parseProjections(
    [
      null,
      "nonsense",
      { player_id: 123, stats: { pts_ppr: 5 } },      // id not a string
      { stats: { pts_ppr: 5 } },                       // no id
      { player_id: "ok", stats: { pts_ppr: "lots" } }, // not a number
      { player_id: "good", stats: { pts_ppr: 9.5 } },
    ],
    "ppr",
  );
  assert.equal(points.size, 1);
  assert.equal(points.get("good"), 9.5);
});

test("garbage payloads yield an empty map, not an exception", () => {
  for (const junk of [null, undefined, 42, "text", [], {}]) {
    assert.equal(parseProjections(junk, "ppr").size, 0);
  }
});

const withStarters = (rosterId: number, starters: string[]): SleeperMatchup => ({
  matchupId: 1,
  rosterId,
  points: 0,
  starters,
});

test("a team's projection is the sum of its starters", () => {
  const projections = new Map([["a", 20], ["b", 15], ["c", 10.5]]);
  const totals = projectTeamScores([withStarters(1, ["a", "b", "c"])], projections);
  assert.equal(totals.get(1), 45.5);
});

test("a mostly-known lineup still projects", () => {
  const projections = new Map([["a", 20], ["b", 15], ["c", 10]]);
  // 3 of 4 starters known -- good enough.
  const totals = projectTeamScores([withStarters(1, ["a", "b", "c", "unknown"])], projections);
  assert.equal(totals.get(1), 45);
});

test("a lineup we mostly cannot price is left out entirely", () => {
  const projections = new Map([["a", 20]]);
  // Only 1 of 5 known -- reporting 20 would be actively misleading.
  const totals = projectTeamScores([withStarters(1, ["a", "v", "w", "x", "y"])], projections);
  assert.equal(totals.has(1), false);
});

test("an empty lineup produces no projection rather than zero", () => {
  assert.equal(projectTeamScores([withStarters(1, [])], new Map([["a", 20]])).has(1), false);
});

test("rounds to cents so totals don't show floating point noise", () => {
  const projections = new Map([["a", 10.1], ["b", 10.2]]);
  assert.equal(projectTeamScores([withStarters(1, ["a", "b"])], projections).get(1), 20.3);
});
