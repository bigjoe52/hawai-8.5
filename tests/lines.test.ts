import { test } from "node:test";
import assert from "node:assert/strict";
import {
  toHalfPoint,
  normalCdf,
  winProbability,
  probabilityToAmerican,
  priceTwoWay,
  formatSpread,
  buildMarkets,
  SCORE_STDEV,
  type TeamLine,
} from "../src/lib/lines.ts";
import { americanToDecimal } from "../src/lib/odds.ts";

const team = (name: string, projected: number, rosterId = 1): TeamLine => ({
  rosterId,
  name,
  projected,
});

test("lines are quoted to the half point", () => {
  assert.equal(toHalfPoint(118.2), 118);
  assert.equal(toHalfPoint(118.3), 118.5);
  assert.equal(toHalfPoint(118.75), 119);
  assert.equal(toHalfPoint(-6.4), -6.5);
});

test("normalCdf matches known values", () => {
  assert.ok(Math.abs(normalCdf(0) - 0.5) < 1e-9);
  assert.ok(Math.abs(normalCdf(1) - 0.8413) < 1e-3);
  assert.ok(Math.abs(normalCdf(-1) - 0.1587) < 1e-3);
  assert.ok(Math.abs(normalCdf(1.96) - 0.975) < 1e-3);
});

test("normalCdf is symmetric about zero", () => {
  for (const z of [0.3, 1, 2.5]) {
    assert.ok(Math.abs(normalCdf(z) + normalCdf(-z) - 1) < 1e-9);
  }
});

test("evenly matched teams are a coin flip", () => {
  assert.ok(Math.abs(winProbability(115, 115) - 0.5) < 1e-9);
});

test("the better projection is favoured, and more so as the gap grows", () => {
  const small = winProbability(120, 115);
  const big = winProbability(140, 100);
  assert.ok(small > 0.5 && small < 0.6, `${small}`);
  assert.ok(big > small);
  assert.ok(big < 1);
});

test("win probabilities of the two sides sum to one", () => {
  assert.ok(Math.abs(winProbability(130, 110) + winProbability(110, 130) - 1) < 1e-9);
});

test("a one-standard-deviation edge is a believable favourite", () => {
  // Not a certainty -- fantasy is noisy, and the model should say so.
  const p = winProbability(115 + SCORE_STDEV, 115);
  assert.ok(p > 0.6 && p < 0.85, `${p} should be a moderate favourite`);
});

test("probabilityToAmerican: favourites are negative, underdogs positive", () => {
  assert.ok(probabilityToAmerican(0.75) < 0);
  assert.ok(probabilityToAmerican(0.25) > 0);
});

test("probabilityToAmerican round-trips through decimal odds", () => {
  for (const p of [0.2, 0.35, 0.6, 0.8]) {
    const american = probabilityToAmerican(p);
    const impliedProbability = 1 / americanToDecimal(american);
    assert.ok(
      Math.abs(impliedProbability - p) < 0.02,
      `${p} -> ${american} -> ${impliedProbability}`,
    );
  }
});

test("a coin flip is priced as a real market, never as impossible odds", () => {
  const odds = probabilityToAmerican(0.5);
  assert.ok(odds <= -100 || odds >= 100, `${odds} is not a valid American price`);
});

test("extreme probabilities stay within a readable range", () => {
  assert.ok(probabilityToAmerican(0.9999) >= -2000);
  assert.ok(probabilityToAmerican(0.0001) <= 2000);
  assert.ok(Number.isFinite(probabilityToAmerican(0)));
  assert.ok(Number.isFinite(probabilityToAmerican(1)));
});

test("every generated price is a legal American price", () => {
  for (let p = 0.01; p < 1; p += 0.01) {
    const odds = probabilityToAmerican(p);
    assert.ok(
      odds <= -100 || odds >= 100,
      `probability ${p.toFixed(2)} produced ${odds}`,
    );
    // Must survive the parlay math used elsewhere in the app.
    assert.ok(Number.isFinite(americanToDecimal(odds)));
  }
});

test("the vig makes both sides sum to more than 100%", () => {
  const [a, b] = priceTwoWay(0.5);
  const total = 1 / americanToDecimal(a) + 1 / americanToDecimal(b);
  assert.ok(total > 1.0, `implied total ${total} should exceed 1`);
  assert.ok(total < 1.10, `implied total ${total} is a bigger vig than intended`);
});

test("the favourite is still the shorter price after vig", () => {
  const [fav, dog] = priceTwoWay(0.7);
  assert.ok(fav < 0, "favourite should be negative");
  assert.ok(dog > 0, "underdog should be positive");
});

test("formatSpread speaks like a sportsbook", () => {
  assert.equal(formatSpread(-6.5), "-6.5");
  assert.equal(formatSpread(6.5), "+6.5");
  assert.equal(formatSpread(0), "PK");
});

test("buildMarkets produces all five markets", () => {
  const markets = buildMarkets(team("Big Kahunas", 121.4), team("Wipeout", 108.9, 2));
  assert.equal(markets.length, 5);
  assert.deepEqual(
    markets.map((m) => m.kind),
    ["moneyline", "spread", "total", "team_total", "team_total"],
  );
  for (const m of markets) assert.equal(m.sides.length, 2);
});

test("the spread points at the favourite", () => {
  const markets = buildMarkets(team("Kahunas", 125), team("Wipeout", 110, 2));
  const spread = markets.find((m) => m.kind === "spread")!;
  // Kahunas are 15 better, so they lay the points.
  assert.ok(spread.sides[0].includes("-15"), spread.sides[0]);
  assert.ok(spread.sides[1].includes("+15"), spread.sides[1]);
});

test("the game total is the sum of both projections", () => {
  const markets = buildMarkets(team("A", 120.2), team("B", 110.4, 2));
  const total = markets.find((m) => m.kind === "total")!;
  assert.ok(total.sides[0].includes("230.5"), total.sides[0]);
  assert.ok(total.sides[1].includes("230.5"), total.sides[1]);
});

test("team totals use each team's own projection", () => {
  const markets = buildMarkets(team("A", 120.2), team("B", 99.8, 2));
  const teamTotals = markets.filter((m) => m.kind === "team_total");
  assert.ok(teamTotals[0].sides[0].includes("120"), teamTotals[0].sides[0]);
  assert.ok(teamTotals[1].sides[0].includes("100"), teamTotals[1].sides[0]);
});

test("the moneyline favours the better projection", () => {
  const markets = buildMarkets(team("Good", 130), team("Bad", 105, 2));
  const ml = markets.find((m) => m.kind === "moneyline")!;
  assert.ok(ml.odds![0] < 0, "better team should be the favourite");
  assert.ok(ml.odds![1] > 0, "worse team should be the underdog");
});

test("an evenly matched game is priced as a pick'em", () => {
  const markets = buildMarkets(team("A", 115), team("B", 115, 2));
  const ml = markets.find((m) => m.kind === "moneyline")!;
  assert.equal(ml.odds![0], ml.odds![1]);
  const spread = markets.find((m) => m.kind === "spread")!;
  assert.ok(spread.sides[0].includes("PK"), spread.sides[0]);
});

test("markets survive absurd projections without producing nonsense", () => {
  for (const [a, b] of [[0, 0], [0, 200], [200, 0], [999, 1]]) {
    const markets = buildMarkets(team("A", a), team("B", b, 2));
    assert.equal(markets.length, 5);
    for (const m of markets) {
      if (!m.odds) continue;
      for (const o of m.odds) {
        assert.ok(o <= -100 || o >= 100, `${a} vs ${b} produced odds ${o}`);
      }
    }
  }
});
