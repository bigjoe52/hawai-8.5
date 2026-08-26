import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isGameMarket,
  classify,
  extractTeams,
  buildBoard,
} from "../src/lib/nfl-board.ts";
import type { PolyMarket } from "../src/lib/polymarket.ts";

const outcomes = (a: string, b: string) => [
  { label: a, probability: 0.55, odds: -120 },
  { label: b, probability: 0.45, odds: 120 },
];

const market = (question: string, endDate: string, volume = 1000): PolyMarket => ({
  id: question,
  question,
  slug: "s",
  endDate,
  outcomes: outcomes("A", "B"),
  volume,
});

// Week 2 of 2026 runs Tue 15 Sep to Tue 22 Sep.
const WEEK2_SUNDAY = "2026-09-20T17:00:00Z";
const WEEK3_SUNDAY = "2026-09-27T17:00:00Z";

/* --- Telling games from futures ------------------------------------------- */

test("a head-to-head game is a game", () => {
  assert.ok(isGameMarket("Chiefs vs Broncos"));
  assert.ok(isGameMarket("Chiefs @ Broncos"));
  assert.ok(isGameMarket("Chiefs at Broncos: who wins?"));
});

test("futures and awards are not games", () => {
  for (const q of [
    "Which team will win the Super Bowl?",
    "NFL MVP 2026",
    "Chiefs season win total",
    "Will any team score 40+ in Week 1?",
    "Who will win the AFC conference?",
    "Bills to make the playoffs",
    "Coach of the Year",
    "Most passing yards in 2026",
    "First team to 10 wins",
    "How many games will the Jets win?",
  ]) {
    assert.equal(isGameMarket(q), false, `"${q}" should not be a game`);
  }
});

test("a market naming only one team is not a game", () => {
  assert.equal(isGameMarket("Chiefs to win"), false);
  assert.equal(isGameMarket("Patrick Mahomes over 250 passing yards"), false);
});

/* --- Classifying the three markets ---------------------------------------- */

test("classify picks out totals", () => {
  assert.equal(classify("Chiefs vs Broncos total points"), "total");
  assert.equal(classify("Chiefs vs Broncos over/under 47.5"), "total");
  assert.equal(classify("Chiefs vs Broncos combined score"), "total");
});

test("classify picks out spreads", () => {
  assert.equal(classify("Chiefs vs Broncos spread"), "spread");
  assert.equal(classify("Will the Chiefs cover vs Broncos?"), "spread");
  assert.equal(classify("Chiefs -6.5 vs Broncos"), "spread");
});

test("anything else is a moneyline", () => {
  assert.equal(classify("Chiefs vs Broncos"), "moneyline");
  assert.equal(classify("Chiefs @ Broncos: who wins?"), "moneyline");
});

/* --- Pulling the team names out ------------------------------------------- */

test("@ means the first team is the visitor", () => {
  assert.deepEqual(extractTeams("Chiefs @ Broncos"), {
    away: "Chiefs", home: "Broncos", separator: "@",
  });
});

test("vs keeps the order given, without inventing a home team", () => {
  // Polymarket's "A vs B" says nothing about who is at home, so the board
  // prints it back the same way instead of guessing.
  assert.deepEqual(extractTeams("Cowboys vs Eagles"), {
    away: "Cowboys", home: "Eagles", separator: "vs",
  });
});

test("a trailing question is trimmed off the team name", () => {
  assert.deepEqual(extractTeams("Chiefs @ Broncos: who wins?"), {
    away: "Chiefs", home: "Broncos", separator: "@",
  });
});

test("an @ wording wins over a vs wording for the same game", () => {
  const board = buildBoard(
    [
      market("Broncos vs Chiefs", WEEK2_SUNDAY),
      market("Chiefs @ Broncos spread", WEEK2_SUNDAY),
    ],
    2,
  );
  assert.equal(board.length, 1);
  assert.equal(board[0].separator, "@");
  assert.equal(board[0].away, "Chiefs");
  assert.equal(board[0].home, "Broncos");
});

test("multi-word team names survive", () => {
  const t = extractTeams("Tampa Bay Buccaneers @ New Orleans Saints")!;
  assert.equal(t.away, "Tampa Bay Buccaneers");
  assert.equal(t.home, "New Orleans Saints");
});

test("a market with no two teams gives nothing", () => {
  assert.equal(extractTeams("Super Bowl winner"), null);
});

/* --- Building the board --------------------------------------------------- */

test("the three markets for one game group together", () => {
  const board = buildBoard(
    [
      market("Chiefs @ Broncos", WEEK2_SUNDAY),
      market("Chiefs @ Broncos spread", WEEK2_SUNDAY),
      market("Chiefs @ Broncos total points", WEEK2_SUNDAY),
    ],
    2,
  );
  assert.equal(board.length, 1);
  assert.ok(board[0].moneyline, "moneyline");
  assert.ok(board[0].spread, "spread");
  assert.ok(board[0].total, "total");
});

test("the same game worded two ways is still one game", () => {
  const board = buildBoard(
    [market("Chiefs @ Broncos", WEEK2_SUNDAY), market("Broncos vs Chiefs spread", WEEK2_SUNDAY)],
    2,
  );
  assert.equal(board.length, 1);
});

test("only the requested week's games appear", () => {
  const board = buildBoard(
    [market("Chiefs @ Broncos", WEEK2_SUNDAY), market("Bills @ Jets", WEEK3_SUNDAY)],
    2,
  );
  assert.deepEqual(board.map((g) => g.away), ["Chiefs"]);
});

test("futures are kept off the board even in the right week", () => {
  const board = buildBoard(
    [
      market("Chiefs @ Broncos", WEEK2_SUNDAY),
      market("Will any team score 40+ in Week 2?", WEEK2_SUNDAY),
      market("NFL MVP", WEEK2_SUNDAY),
    ],
    2,
  );
  assert.equal(board.length, 1);
});

test("a market with no date is left out rather than guessed at", () => {
  const noDate = { ...market("Chiefs @ Broncos", WEEK2_SUNDAY), endDate: null };
  assert.equal(buildBoard([noDate], 2).length, 0);
});

test("an unparseable date is left out too", () => {
  const bad = { ...market("Chiefs @ Broncos", WEEK2_SUNDAY), endDate: "not a date" };
  assert.equal(buildBoard([bad], 2).length, 0);
});

test("games come back in kickoff order", () => {
  const board = buildBoard(
    [
      market("Bills @ Jets", "2026-09-20T20:00:00Z"),
      market("Chiefs @ Broncos", "2026-09-17T00:20:00Z"),
      market("Rams @ Niners", "2026-09-20T17:00:00Z"),
    ],
    2,
  );
  assert.deepEqual(board.map((g) => g.away), ["Chiefs", "Rams", "Bills"]);
});

test("a game with only a moneyline still shows, with the rest blank", () => {
  const board = buildBoard([market("Chiefs @ Broncos", WEEK2_SUNDAY)], 2);
  assert.ok(board[0].moneyline);
  assert.equal(board[0].spread, null);
  assert.equal(board[0].total, null);
});

test("the busiest market of a kind wins", () => {
  // buildBoard trusts the incoming order, which is busiest-first.
  const board = buildBoard(
    [
      { ...market("Chiefs @ Broncos", WEEK2_SUNDAY, 9000), outcomes: outcomes("Busy", "X") },
      { ...market("Chiefs @ Broncos", WEEK2_SUNDAY, 5), outcomes: outcomes("Quiet", "Y") },
    ],
    2,
  );
  assert.equal(board[0].moneyline![0].label, "Busy");
});

test("an empty market list gives an empty board", () => {
  assert.deepEqual(buildBoard([], 2), []);
});

/* --- Team names must survive the market wording --------------------------- */

test("market words trailing the team name are stripped", () => {
  for (const q of [
    "Chiefs @ Broncos spread",
    "Chiefs @ Broncos total points",
    "Chiefs @ Broncos moneyline",
    "Chiefs @ Broncos odds",
    "Chiefs @ Broncos -6.5",
    "Chiefs @ Broncos over 47.5",
  ]) {
    assert.equal(extractTeams(q)!.home, "Broncos", q);
  }
});

test("a team whose own name contains a market word is not butchered", () => {
  // Stripping stops at the first non-descriptor word, so nothing inside the
  // name is touched.
  assert.equal(extractTeams("Jets @ Kansas City Chiefs")!.home, "Kansas City Chiefs");
  assert.equal(extractTeams("Chiefs @ New York Giants")!.home, "New York Giants");
});

test("all three wordings produce the same game key", () => {
  const board = buildBoard(
    [
      market("Chiefs @ Broncos", WEEK2_SUNDAY),
      market("Chiefs @ Broncos spread", WEEK2_SUNDAY),
      market("Chiefs @ Broncos total points", WEEK2_SUNDAY),
      market("Chiefs @ Broncos moneyline odds", WEEK2_SUNDAY),
    ],
    2,
  );
  assert.equal(board.length, 1, "all four are the same game");
});

test("slashed market words like over/under are stripped", () => {
  for (const q of [
    "Cowboys vs Eagles over/under",
    "Cowboys vs Eagles o/u",
    "Cowboys vs Eagles over/under 45.5",
  ]) {
    assert.equal(extractTeams(q)!.home, "Eagles", q);
  }
});

test("an over/under market joins its game rather than making a new one", () => {
  const board = buildBoard(
    [
      market("Cowboys vs Eagles", WEEK2_SUNDAY),
      market("Cowboys vs Eagles spread", WEEK2_SUNDAY),
      market("Cowboys vs Eagles over/under", WEEK2_SUNDAY),
    ],
    2,
  );
  assert.equal(board.length, 1, "one game, not three");
  assert.ok(board[0].moneyline && board[0].spread && board[0].total);
});

test("a slash inside a real team name is not stripped", () => {
  // Nothing in the NFL, but the rule must not eat a legitimate word.
  assert.equal(extractTeams("Jets @ Real/Madrid")!.home, "Real/Madrid");
});
