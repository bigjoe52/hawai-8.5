import { test } from "node:test";
import assert from "node:assert/strict";
import {
  americanToDecimal,
  decimalToAmerican,
  combinedDecimalOdds,
  resolveParlay,
  parlayPayoutCents,
  parlayProfitCents,
  formatCents,
  formatAmerican,
  parseStakeToCents,
  type Leg,
} from "../src/lib/odds.ts";

const leg = (oddsAmerican: number, status: Leg["status"] = "win"): Leg => ({
  oddsAmerican,
  status,
});

test("americanToDecimal converts positive odds", () => {
  assert.equal(americanToDecimal(100), 2);
  assert.equal(americanToDecimal(250), 3.5);
  assert.equal(americanToDecimal(1000), 11);
});

test("americanToDecimal converts negative odds", () => {
  assert.equal(americanToDecimal(-100), 2);
  assert.ok(Math.abs(americanToDecimal(-110) - 1.909090909) < 1e-6);
  assert.equal(americanToDecimal(-200), 1.5);
});

test("americanToDecimal rejects impossible odds", () => {
  // Nothing between -100 and +100 is a valid American price.
  assert.throws(() => americanToDecimal(0));
  assert.throws(() => americanToDecimal(50));
  assert.throws(() => americanToDecimal(-99));
  assert.throws(() => americanToDecimal(NaN));
});

test("decimalToAmerican round-trips", () => {
  for (const odds of [-500, -200, -110, 100, 250, 900]) {
    assert.equal(decimalToAmerican(americanToDecimal(odds)), odds);
  }
});

test("combinedDecimalOdds multiplies legs together", () => {
  // Two coin-flip legs at +100 each = 4x the stake.
  assert.equal(combinedDecimalOdds([leg(100), leg(100)]), 4);
  assert.equal(combinedDecimalOdds([]), 1);
});

test("a pushed leg drops out of the parlay instead of killing it", () => {
  const withPush = combinedDecimalOdds([leg(100), leg(250, "push")]);
  const without = combinedDecimalOdds([leg(100)]);
  assert.equal(withPush, without);
});

test("resolveParlay: one loss kills the ticket even with legs still pending", () => {
  assert.equal(
    resolveParlay([leg(-110, "win"), leg(-110, "loss"), leg(-110, "pending")]),
    "lost",
  );
});

test("resolveParlay: needs every leg graded before it can win", () => {
  assert.equal(resolveParlay([leg(-110, "win"), leg(-110, "pending")]), "pending");
  assert.equal(resolveParlay([leg(-110, "win"), leg(-110, "win")]), "won");
});

test("resolveParlay: empty or all-push ticket is not a winner", () => {
  assert.equal(resolveParlay([]), "pending");
  assert.equal(resolveParlay([leg(-110, "push"), leg(-110, "push")]), "lost");
});

test("parlayPayoutCents pays out the full ticket including stake", () => {
  // $10 on two +100 legs => 4x => $40 back.
  assert.equal(parlayPayoutCents([leg(100), leg(100)], 1000), 4000);
  // A dead ticket pays nothing.
  assert.equal(parlayPayoutCents([leg(100), leg(100, "loss")], 1000), 0);
});

test("parlayProfitCents subtracts the stake, and loses it on a bust", () => {
  assert.equal(parlayProfitCents([leg(100), leg(100)], 1000), 3000);
  assert.equal(parlayProfitCents([leg(100), leg(100, "loss")], 1000), -1000);
  // Nothing is won or lost until it is graded.
  assert.equal(parlayProfitCents([leg(100), leg(100, "pending")], 1000), 0);
});

test("a realistic 10-leg parlay at -110 pays roughly 600x", () => {
  const legs = Array.from({ length: 10 }, () => leg(-110));
  const payout = parlayPayoutCents(legs, 1000); // $10 ticket
  // 1.9090909^10 is ~645.6, so a $10 ticket returns ~$6456.
  assert.ok(payout > 600_000 && payout < 700_000, `got ${payout}`);
});

test("payouts stay whole cents", () => {
  const payout = parlayPayoutCents([leg(-110), leg(-110), leg(-110)], 333);
  assert.ok(Number.isInteger(payout), `${payout} is not a whole number of cents`);
});

test("stake must be whole non-negative cents", () => {
  assert.throws(() => parlayPayoutCents([leg(100)], 10.5));
  assert.throws(() => parlayPayoutCents([leg(100)], -100));
});

test("formatCents renders dollars, including negatives and thousands", () => {
  assert.equal(formatCents(0), "$0.00");
  assert.equal(formatCents(1250), "$12.50");
  assert.equal(formatCents(5), "$0.05");
  assert.equal(formatCents(-2000), "-$20.00");
  assert.equal(formatCents(123456), "$1,234.56");
});

test("formatAmerican always shows a sign", () => {
  assert.equal(formatAmerican(250), "+250");
  assert.equal(formatAmerican(-110), "-110");
});

test("parseStakeToCents accepts what people actually type", () => {
  assert.equal(parseStakeToCents("25"), 2500);
  assert.equal(parseStakeToCents("$25"), 2500);
  assert.equal(parseStakeToCents(" 25.50 "), 2550);
  assert.equal(parseStakeToCents("25.5"), 2550);
  assert.equal(parseStakeToCents("1,000"), 100000);
});

test("parseStakeToCents rejects junk", () => {
  assert.throws(() => parseStakeToCents("twenty"));
  assert.throws(() => parseStakeToCents("25.999"));
  assert.throws(() => parseStakeToCents("-25"));
  assert.throws(() => parseStakeToCents(""));
});
