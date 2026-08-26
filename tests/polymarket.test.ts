import { test } from "node:test";
import assert from "node:assert/strict";
import { parseJsonArray, parseMarket, parseMarkets } from "../src/lib/polymarket.ts";

/** A row shaped the way Gamma actually sends them. */
const row = (over: Record<string, unknown> = {}) => ({
  id: "512",
  question: "Chiefs vs Broncos: who wins?",
  slug: "chiefs-broncos",
  // Note: JSON-encoded strings, not arrays. This is the real shape.
  outcomes: '["Chiefs","Broncos"]',
  outcomePrices: '["0.72","0.28"]',
  endDate: "2026-09-14T00:00:00Z",
  volume: "125000",
  ...over,
});

test("parseJsonArray copes with the JSON-string form Gamma sends", () => {
  assert.deepEqual(parseJsonArray('["Yes","No"]'), ["Yes", "No"]);
});

test("parseJsonArray also accepts a plain array", () => {
  assert.deepEqual(parseJsonArray(["Yes", "No"]), ["Yes", "No"]);
});

test("parseJsonArray returns empty for junk rather than throwing", () => {
  for (const junk of ["not json", "{}", null, undefined, 42, {}]) {
    assert.deepEqual(parseJsonArray(junk), []);
  }
});

test("a market converts prices into American odds", () => {
  const m = parseMarket(row())!;
  assert.equal(m.question, "Chiefs vs Broncos: who wins?");
  assert.equal(m.outcomes.length, 2);
  assert.equal(m.outcomes[0].label, "Chiefs");
  assert.ok(Math.abs(m.outcomes[0].probability - 0.72) < 1e-9);
  // 0.72 is a favourite, so a negative price.
  assert.ok(m.outcomes[0].odds < 0);
  assert.ok(m.outcomes[1].odds > 0);
});

test("odds round-trip back to roughly the original probability", () => {
  const m = parseMarket(row({ outcomePrices: '["0.65","0.35"]' }))!;
  for (const o of m.outcomes) {
    const decimal = o.odds > 0 ? o.odds / 100 + 1 : 100 / Math.abs(o.odds) + 1;
    assert.ok(
      Math.abs(1 / decimal - o.probability) < 0.02,
      `${o.probability} -> ${o.odds} -> ${1 / decimal}`,
    );
  }
});

test("every generated price is a legal American price", () => {
  for (let p = 0.02; p < 0.99; p += 0.02) {
    const m = parseMarket(
      row({ outcomePrices: `["${p.toFixed(2)}","${(1 - p).toFixed(2)}"]` }),
    )!;
    for (const o of m.outcomes) {
      assert.ok(o.odds <= -100 || o.odds >= 100, `p=${p} gave ${o.odds}`);
    }
  }
});

test("an already-resolved market is skipped, not shown as a free bet", () => {
  assert.equal(parseMarket(row({ outcomePrices: '["1","0"]' })), null);
  assert.equal(parseMarket(row({ outcomePrices: '["0","1"]' })), null);
});

test("a market missing its question is skipped", () => {
  assert.equal(parseMarket(row({ question: undefined })), null);
});

test("mismatched outcomes and prices are skipped", () => {
  assert.equal(parseMarket(row({ outcomePrices: '["0.5"]' })), null);
});

test("junk rows are skipped rather than thrown on", () => {
  for (const junk of [null, undefined, "text", 42, {}, []]) {
    assert.equal(parseMarket(junk), null);
  }
});

test("parseMarkets reads a bare array", () => {
  assert.equal(parseMarkets([row(), row({ id: "513" })]).length, 2);
});

test("parseMarkets digs markets out of events", () => {
  const events = [{ id: "e1", markets: [row(), row({ id: "513" })] }];
  assert.equal(parseMarkets(events).length, 2);
});

test("parseMarkets reads the wrapped forms too", () => {
  assert.equal(parseMarkets({ data: [row()] }).length, 1);
  assert.equal(parseMarkets({ markets: [row()] }).length, 1);
  assert.equal(parseMarkets({ events: [{ markets: [row()] }] }).length, 1);
});

test("busiest markets come first", () => {
  const markets = parseMarkets([
    row({ id: "a", volume: "100" }),
    row({ id: "b", volume: "900000" }),
    row({ id: "c", volume: "5000" }),
  ]);
  assert.deepEqual(markets.map((m) => m.id), ["b", "c", "a"]);
});

test("a mix of good and bad rows keeps only the good ones", () => {
  const markets = parseMarkets([
    row({ id: "good" }),
    null,
    row({ id: "resolved", outcomePrices: '["1","0"]' }),
    "nonsense",
    row({ id: "alsogood", volume: "1" }),
  ]);
  assert.deepEqual(markets.map((m) => m.id), ["good", "alsogood"]);
});

test("garbage payloads give an empty list, not an exception", () => {
  for (const junk of [null, undefined, 42, "text", {}, []]) {
    assert.deepEqual(parseMarkets(junk), []);
  }
});

test("a three-way market is kept whole", () => {
  const m = parseMarket(
    row({ outcomes: '["A","B","Draw"]', outcomePrices: '["0.5","0.4","0.1"]' }),
  )!;
  assert.equal(m.outcomes.length, 3);
});

test("volume that is missing or unparseable becomes zero", () => {
  assert.equal(parseMarket(row({ volume: undefined }))!.volume, 0);
  assert.equal(parseMarket(row({ volume: "lots" }))!.volume, 0);
});
