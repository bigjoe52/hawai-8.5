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

const m = (matchupId: number, rosterId: number, points: number): SleeperMatchup => ({
  matchupId,
  rosterId,
  points,
});

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
