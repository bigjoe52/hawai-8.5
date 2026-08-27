import { test } from "node:test";
import assert from "node:assert/strict";
import {
  rankLegRecords,
  formatRecord,
  formatHitRate,
  ROAST_THRESHOLD,
} from "../src/lib/leg-standings.ts";
import type { LegRecord } from "../src/lib/queries.ts";

let id = 1;
const rec = (
  displayName: string,
  wins: number,
  losses: number,
  extra: Partial<LegRecord> = {},
): LegRecord => ({
  userId: id++,
  displayName,
  wins,
  losses,
  pushes: 0,
  pending: 0,
  soloBusts: 0,
  ...extra,
});

test("best hit rate ranks first", () => {
  const ranked = rankLegRecords([rec("Will", 2, 10), rec("Joe", 8, 4), rec("Biz", 5, 5)]);
  assert.deepEqual(ranked.map((r) => r.displayName), ["Joe", "Biz", "Will"]);
});

test("hit rate ignores pushes and pending legs", () => {
  const ranked = rankLegRecords([rec("Joe", 3, 1, { pushes: 5, pending: 4 })]);
  assert.equal(ranked[0].decided, 4);
  assert.equal(ranked[0].hitRate, 0.75);
});

test("somebody with nothing decided sinks to the bottom, unranked", () => {
  const ranked = rankLegRecords([
    rec("Nobody", 0, 0, { pending: 2 }),
    rec("Will", 1, 9),
  ]);
  assert.deepEqual(ranked.map((r) => r.displayName), ["Will", "Nobody"]);
  assert.equal(ranked[1].hitRate, null);
  assert.equal(ranked[1].isWorst, false, "no legs decided is not the worst record");
});

test("the worst gets flagged, once the sample is real", () => {
  const ranked = rankLegRecords([rec("Joe", 8, 2), rec("Will", 2, 10), rec("Biz", 5, 5)]);
  const will = ranked.find((r) => r.displayName === "Will")!;
  assert.equal(will.isWorst, true);
  assert.equal(ranked.filter((r) => r.isWorst).length, 1, "only one worst");
});

test("a tiny sample is not enough to brand somebody", () => {
  // Two legs, both lost. Bad luck, not a season.
  const ranked = rankLegRecords([rec("Joe", 5, 1), rec("Unlucky", 0, 2)]);
  assert.equal(ranked.find((r) => r.displayName === "Unlucky")!.isWorst, false);
});

test("the threshold is exactly where it says", () => {
  const atThreshold = rankLegRecords([
    rec("Joe", 5, 1),
    rec("Edge", 0, ROAST_THRESHOLD),
  ]);
  assert.equal(atThreshold.find((r) => r.displayName === "Edge")!.isWorst, true);

  const below = rankLegRecords([
    rec("Joe", 5, 1),
    rec("Edge", 0, ROAST_THRESHOLD - 1),
  ]);
  assert.equal(below.find((r) => r.displayName === "Edge")!.isWorst, false);
});

test("nobody is flagged when nobody has played enough", () => {
  const ranked = rankLegRecords([rec("A", 1, 1), rec("B", 0, 1)]);
  assert.equal(ranked.filter((r) => r.isWorst).length, 0);
});

test("equal rates break on wins, then on solo busts", () => {
  const ranked = rankLegRecords([
    rec("Fewer", 2, 2, { soloBusts: 0 }),
    rec("More", 4, 4, { soloBusts: 0 }),
  ]);
  assert.equal(ranked[0].displayName, "More", "same 50%, more wins ranks higher");

  const busts = rankLegRecords([
    rec("Clean", 4, 4, { soloBusts: 0 }),
    rec("Guilty", 4, 4, { soloBusts: 3 }),
  ]);
  assert.equal(busts[0].displayName, "Clean");
});

test("ranking is stable and total, whatever comes in", () => {
  const ranked = rankLegRecords([
    rec("Zed", 0, 0), rec("Amy", 0, 0), rec("Will", 2, 10), rec("Joe", 8, 4),
  ]);
  assert.equal(ranked.length, 4);
  // Unranked players are alphabetical among themselves.
  assert.deepEqual(ranked.slice(2).map((r) => r.displayName), ["Amy", "Zed"]);
});

test("an empty league ranks to nothing", () => {
  assert.deepEqual(rankLegRecords([]), []);
});

test("formatRecord shows pushes only when there are any", () => {
  assert.equal(formatRecord(rec("A", 2, 10)), "2-10");
  assert.equal(formatRecord(rec("A", 2, 10, { pushes: 1 })), "2-10-1");
});

test("formatHitRate rounds to whole percent", () => {
  assert.equal(formatHitRate(null), "—");
  assert.equal(formatHitRate(0), "0%");
  assert.equal(formatHitRate(1), "100%");
  assert.equal(formatHitRate(2 / 12), "17%");
  assert.equal(formatHitRate(1 / 3), "33%");
});
