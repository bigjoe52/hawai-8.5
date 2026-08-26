import { test } from "node:test";
import assert from "node:assert/strict";
import {
  toHalfPoint,
  normalCdf,
  winProbability,
  probabilityToAmerican,
  priceTwoWay,
  winningsFor,
  headToHead,
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

test("a coin flip is even money, written one way", () => {
  assert.equal(probabilityToAmerican(0.5), 100);
  const [a, b] = priceTwoWay(0.5);
  assert.equal(a, 100);
  assert.equal(b, 100);
});

test("even money pays back what you put up", () => {
  assert.deepEqual(headToHead(100, 500), { yourRisk: 500, theirRisk: 500 });
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

test("prices are fair: the two sides sum to 100%, no vig", () => {
  for (const p of [0.5, 0.6, 0.75, 0.35]) {
    const [a, b] = priceTwoWay(p);
    const total = 1 / americanToDecimal(a) + 1 / americanToDecimal(b);
    // Only rounding to the nearest 5 moves it off exactly 1.
    assert.ok(
      Math.abs(total - 1) < 0.02,
      `probability ${p} implied a total of ${total}, expected ~1`,
    );
  }
});

test("an even matchup prices both sides identically", () => {
  const [a, b] = priceTwoWay(0.5);
  assert.equal(a, b);
});

test("the favourite is the shorter price", () => {
  const [fav, dog] = priceTwoWay(0.7);
  assert.ok(fav < 0, "favourite should be negative");
  assert.ok(dog > 0, "underdog should be positive");
});

test("formatSpread speaks like a sportsbook", () => {
  assert.equal(formatSpread(-6.5), "-6.5");
  assert.equal(formatSpread(6.5), "+6.5");
  assert.equal(formatSpread(0), "PK");
});

test("only the moneyline carries a price; the rest are straight up", () => {
  const markets = buildMarkets(team("A", 121.4), team("B", 108.9, 2));
  const priced = markets.filter((m) => m.odds !== null);
  assert.equal(priced.length, 1);
  assert.equal(priced[0].kind, "moneyline");
  for (const m of markets.filter((m) => m.kind !== "moneyline")) {
    assert.equal(m.odds, null, `${m.title} should have no odds`);
  }
});

test("no -110 anywhere: straight-up markets show no price at all", () => {
  const markets = buildMarkets(team("A", 121.4), team("B", 108.9, 2));
  for (const m of markets) {
    if (m.kind === "moneyline") continue;
    assert.equal(m.odds, null);
  }
});

test("winningsFor: what you collect on a favourite", () => {
  // -280 laying $5.00 wins 5 * 100/280 = $1.79
  assert.equal(winningsFor(-280, 500), 179);
  // -200 laying $10 wins $5
  assert.equal(winningsFor(-200, 1000), 500);
});

test("winningsFor: what you collect on an underdog", () => {
  // +280 risking $5.00 wins $14.00
  assert.equal(winningsFor(280, 500), 1400);
  assert.equal(winningsFor(100, 500), 500);
});

test("winningsFor never rounds a real bet away to nothing", () => {
  assert.ok(winningsFor(-5000, 1) >= 1);
});

test("winningsFor rejects a nonsense risk", () => {
  assert.throws(() => winningsFor(-110, 0));
  assert.throws(() => winningsFor(-110, -500));
  assert.throws(() => winningsFor(-110, 5.5));
});

test("headToHead: a straight-up bet is the same on both sides", () => {
  assert.deepEqual(headToHead(null, 500), { yourRisk: 500, theirRisk: 500 });
});

test("headToHead: a priced bet is asymmetric", () => {
  // Backing a -280 favourite: you put up $5 to win $1.79, so that is what
  // they are putting up.
  assert.deepEqual(headToHead(-280, 500), { yourRisk: 500, theirRisk: 179 });
  // Backing the +280 dog: you put up $5 to win $14.
  assert.deepEqual(headToHead(280, 500), { yourRisk: 500, theirRisk: 1400 });
});

test("the favourite risks more than the underdog for the same prize", () => {
  const backingFavourite = headToHead(-280, 500);
  assert.ok(backingFavourite.yourRisk > backingFavourite.theirRisk);
  const backingDog = headToHead(280, 500);
  assert.ok(backingDog.yourRisk < backingDog.theirRisk);
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
