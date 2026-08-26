import { test } from "node:test";
import assert from "node:assert/strict";
import { gradeBet, describePick, type GradeableBet } from "../src/lib/grading.ts";

const bet = (kind: GradeableBet["kind"], line: number, pick: GradeableBet["pick"]): GradeableBet =>
  ({ kind, line, pick });

/* --- Moneyline ------------------------------------------------------------ */

test("moneyline: the higher score wins", () => {
  assert.equal(gradeBet(bet("moneyline", 0, "home"), { homePoints: 120, awayPoints: 100 }), "proposer");
  assert.equal(gradeBet(bet("moneyline", 0, "home"), { homePoints: 100, awayPoints: 120 }), "taker");
  assert.equal(gradeBet(bet("moneyline", 0, "away"), { homePoints: 100, awayPoints: 120 }), "proposer");
  assert.equal(gradeBet(bet("moneyline", 0, "away"), { homePoints: 120, awayPoints: 100 }), "taker");
});

test("moneyline: an exact tie is a push", () => {
  assert.equal(gradeBet(bet("moneyline", 0, "home"), { homePoints: 111.5, awayPoints: 111.5 }), "push");
});

test("moneyline: a tenth of a point still decides it", () => {
  assert.equal(gradeBet(bet("moneyline", 0, "home"), { homePoints: 111.6, awayPoints: 111.5 }), "proposer");
});

/* --- Spread --------------------------------------------------------------- */

test("spread: the favourite must win by more than the line", () => {
  const laying20 = bet("spread", 20, "home");
  // Won by 25 -- covered.
  assert.equal(gradeBet(laying20, { homePoints: 125, awayPoints: 100 }), "proposer");
  // Won by 15 -- won the game, lost the bet.
  assert.equal(gradeBet(laying20, { homePoints: 115, awayPoints: 100 }), "taker");
});

test("spread: the underdog covers by losing close, or winning", () => {
  const taking20 = bet("spread", 20, "away");
  assert.equal(gradeBet(taking20, { homePoints: 115, awayPoints: 100 }), "proposer");
  assert.equal(gradeBet(taking20, { homePoints: 90, awayPoints: 100 }), "proposer");
  assert.equal(gradeBet(taking20, { homePoints: 130, awayPoints: 100 }), "taker");
});

test("spread: landing exactly on the number is a push", () => {
  assert.equal(gradeBet(bet("spread", 20, "home"), { homePoints: 120, awayPoints: 100 }), "push");
  assert.equal(gradeBet(bet("spread", 20, "away"), { homePoints: 120, awayPoints: 100 }), "push");
});

test("spread: a half-point line can never push", () => {
  assert.equal(gradeBet(bet("spread", 20.5, "home"), { homePoints: 120, awayPoints: 100 }), "taker");
  assert.equal(gradeBet(bet("spread", 20.5, "home"), { homePoints: 121, awayPoints: 100 }), "proposer");
});

test("spread: a negative line means the home side is the underdog", () => {
  // Home getting 6.5: line is -6.5, so home covers unless it loses by 7+.
  const homeDog = bet("spread", -6.5, "home");
  assert.equal(gradeBet(homeDog, { homePoints: 100, awayPoints: 104 }), "proposer");
  assert.equal(gradeBet(homeDog, { homePoints: 100, awayPoints: 110 }), "taker");
});

/* --- Game total ----------------------------------------------------------- */

test("total: both scores added together", () => {
  assert.equal(gradeBet(bet("total", 206.5, "over"), { homePoints: 113, awayPoints: 100 }), "proposer");
  assert.equal(gradeBet(bet("total", 206.5, "over"), { homePoints: 100, awayPoints: 100 }), "taker");
  assert.equal(gradeBet(bet("total", 206.5, "under"), { homePoints: 100, awayPoints: 100 }), "proposer");
});

test("total: exactly on the number is a push", () => {
  assert.equal(gradeBet(bet("total", 200, "over"), { homePoints: 120, awayPoints: 80 }), "push");
});

/* --- Team total ----------------------------------------------------------- */

test("team total: only the subject team's score matters", () => {
  const over = bet("team_total", 113.5, "over");
  assert.equal(gradeBet(over, { homePoints: 0, awayPoints: 0, subjectPoints: 120 }), "proposer");
  assert.equal(gradeBet(over, { homePoints: 999, awayPoints: 0, subjectPoints: 100 }), "taker");
});

test("team total: under wins when the team falls short", () => {
  const under = bet("team_total", 113.5, "under");
  assert.equal(gradeBet(under, { homePoints: 0, awayPoints: 0, subjectPoints: 100 }), "proposer");
});

test("team total: exactly on the number is a push", () => {
  assert.equal(
    gradeBet(bet("team_total", 113, "over"), { homePoints: 0, awayPoints: 0, subjectPoints: 113 }),
    "push",
  );
});

test("team total with no subject score is left alone, not guessed", () => {
  assert.equal(gradeBet(bet("team_total", 113.5, "over"), { homePoints: 120, awayPoints: 100 }), null);
});

/* --- Refusals ------------------------------------------------------------- */

test("a pick that does not belong to the market is refused", () => {
  assert.equal(gradeBet(bet("moneyline", 0, "over"), { homePoints: 120, awayPoints: 100 }), null);
  assert.equal(gradeBet(bet("total", 200, "home"), { homePoints: 120, awayPoints: 100 }), null);
  assert.equal(gradeBet(bet("spread", 3, "under"), { homePoints: 120, awayPoints: 100 }), null);
});

test("missing or nonsense scores are refused rather than graded", () => {
  assert.equal(gradeBet(bet("moneyline", 0, "home"), { homePoints: NaN, awayPoints: 100 }), null);
  assert.equal(
    gradeBet(bet("total", 200, "over"), { homePoints: Infinity, awayPoints: 100 }),
    null,
  );
});

test("an unknown market kind is refused", () => {
  // @ts-expect-error deliberately invalid
  assert.equal(gradeBet({ kind: "parlay", line: 1, pick: "home" }, { homePoints: 1, awayPoints: 2 }), null);
});

/* --- The two sides always disagree ---------------------------------------- */

test("whatever the result, exactly one side wins (or both push)", () => {
  const scores = { homePoints: 118.4, awayPoints: 104.2, subjectPoints: 118.4 };
  const markets: Array<[GradeableBet["kind"], number, GradeableBet["pick"], GradeableBet["pick"]]> = [
    ["moneyline", 0, "home", "away"],
    ["spread", 12.5, "home", "away"],
    ["total", 220.5, "over", "under"],
    ["team_total", 115.5, "over", "under"],
  ];
  for (const [kind, line, sideA, sideB] of markets) {
    const a = gradeBet(bet(kind, line, sideA), scores);
    const b = gradeBet(bet(kind, line, sideB), scores);
    assert.ok(a && b, `${kind} should grade`);
    if (a === "push") {
      assert.equal(b, "push", `${kind}: a push for one side must push for both`);
    } else {
      assert.notEqual(a, b, `${kind}: both sides cannot get the same result`);
    }
  }
});

test("describePick maps board positions to sides", () => {
  assert.equal(describePick("moneyline", 0), "home");
  assert.equal(describePick("moneyline", 1), "away");
  assert.equal(describePick("spread", 0), "home");
  assert.equal(describePick("spread", 1), "away");
  assert.equal(describePick("total", 0), "over");
  assert.equal(describePick("total", 1), "under");
  assert.equal(describePick("team_total", 0), "over");
  assert.equal(describePick("team_total", 1), "under");
});
