import { test } from "node:test";
import assert from "node:assert/strict";
import { weekAt, currentWeek, normaliseWeek, SEASON, LAST_WEEK } from "../src/lib/week.ts";

/** Build an instant from an Eastern wall-clock time. */
const et = (iso: string, offset: string) => new Date(`${iso}${offset}`);
const EDT = "-04:00"; // through 1 Nov 2026
const EST = "-05:00"; // from 1 Nov 2026

test("everything before the first rollover is week 1", () => {
  assert.equal(weekAt(new Date("2026-01-01T00:00:00Z")), 1);
  assert.equal(weekAt(et("2026-08-26T12:00:00", EDT)), 1);
  assert.equal(weekAt(et("2026-09-10T20:00:00", EDT)), 1); // opening Thursday
  assert.equal(weekAt(et("2026-09-14T23:59:00", EDT)), 1); // Monday night
});

test("week 1 holds right up to 3am Eastern on Tuesday 15 September", () => {
  assert.equal(weekAt(et("2026-09-15T02:59:00", EDT)), 1);
});

test("it becomes week 2 at exactly 3am Eastern that Tuesday", () => {
  assert.equal(weekAt(et("2026-09-15T03:00:00", EDT)), 2);
  assert.equal(weekAt(et("2026-09-15T03:01:00", EDT)), 2);
});

test("the rest of that Tuesday, and the following days, stay week 2", () => {
  assert.equal(weekAt(et("2026-09-15T23:00:00", EDT)), 2);
  assert.equal(weekAt(et("2026-09-18T12:00:00", EDT)), 2); // Friday
  assert.equal(weekAt(et("2026-09-21T22:00:00", EDT)), 2); // Monday night
});

test("it ticks over again the next Tuesday at 3am", () => {
  assert.equal(weekAt(et("2026-09-22T02:59:00", EDT)), 2);
  assert.equal(weekAt(et("2026-09-22T03:00:00", EDT)), 3);
});

test("late Monday night is still the old week, not the new one", () => {
  // 1am Tuesday -- games are over but the week has not turned yet.
  assert.equal(weekAt(et("2026-09-22T01:00:00", EDT)), 2);
});

test("weeks keep incrementing one per Tuesday", () => {
  const tuesdays = [
    ["2026-09-15", 2],
    ["2026-09-22", 3],
    ["2026-09-29", 4],
    ["2026-10-06", 5],
    ["2026-10-13", 6],
    ["2026-10-20", 7],
    ["2026-10-27", 8],
  ] as const;
  for (const [date, expected] of tuesdays) {
    assert.equal(weekAt(et(`${date}T03:00:00`, EDT)), expected, date);
  }
});

test("the rollover stays at 3am local after daylight saving ends", () => {
  // DST ends 1 Nov 2026, so these Tuesdays are EST (UTC-5), not EDT.
  // A naive "add 7 days to a fixed instant" would drift to 2am here.
  assert.equal(weekAt(et("2026-11-03T02:59:00", EST)), 8);
  assert.equal(weekAt(et("2026-11-03T03:00:00", EST)), 9);
  assert.equal(weekAt(et("2026-11-10T03:00:00", EST)), 10);
});

test("the season stops at week 18 rather than running away", () => {
  assert.equal(weekAt(et("2027-01-05T03:00:00", EST)), LAST_WEEK);
  assert.equal(weekAt(new Date("2027-06-01T00:00:00Z")), LAST_WEEK);
});

test("every week from 1 to 18 is reachable, in order, with no gaps", () => {
  const seen: number[] = [];
  // Walk from the season opener to February, a day at a time, at noon ET.
  for (let d = 0; d < 150; d++) {
    const day = new Date(Date.UTC(2026, 8, 8) + d * 86_400_000);
    const iso = day.toISOString().slice(0, 10);
    const offset = day < new Date("2026-11-01T06:00:00Z") ? EDT : EST;
    const week = weekAt(et(`${iso}T12:00:00`, offset));
    if (seen[seen.length - 1] !== week) seen.push(week);
  }
  assert.deepEqual(seen, Array.from({ length: 18 }, (_, i) => i + 1));
});

test("a week lasts exactly seven days", () => {
  let changes = 0;
  for (let d = 0; d < 7; d++) {
    const day = new Date(Date.UTC(2026, 8, 15) + d * 86_400_000);
    const iso = day.toISOString().slice(0, 10);
    if (weekAt(et(`${iso}T12:00:00`, EDT)) !== 2) changes++;
  }
  assert.equal(changes, 0, "week 2 should cover all seven of its days");
});

test("currentWeek reports the fixed season", () => {
  const ctx = currentWeek(et("2026-09-22T03:00:00", EDT));
  assert.equal(ctx.season, SEASON);
  assert.equal(ctx.week, 3);
});

test("normaliseWeek accepts real weeks and rejects nonsense", () => {
  assert.equal(normaliseWeek("5", 1), 5);
  assert.equal(normaliseWeek(18, 1), 18);
  assert.equal(normaliseWeek("0", 7), 7);
  assert.equal(normaliseWeek("19", 7), 7);
  assert.equal(normaliseWeek("-3", 7), 7);
  assert.equal(normaliseWeek("banana", 7), 7);
  assert.equal(normaliseWeek(undefined, 7), 7);
  assert.equal(normaliseWeek("2.5", 7), 7);
});

/* --- Week windows, for filtering the NFL slate ---------------------------- */

import { weekWindow, weekOfKickoff } from "../src/lib/week.ts";

test("a week window is exactly seven days", () => {
  for (const w of [2, 5, 10, 17]) {
    const { start, end } = weekWindow(w);
    assert.equal((end.getTime() - start.getTime()) / 86_400_000, 7, `week ${w}`);
  }
});

test("consecutive weeks butt up against each other with no gap", () => {
  for (let w = 1; w < 18; w++) {
    assert.equal(weekWindow(w).end.getTime(), weekWindow(w + 1).start.getTime());
  }
});

test("week 2 starts on the anchor Tuesday", () => {
  const { start } = weekWindow(2);
  assert.equal(start.toISOString().slice(0, 10), "2026-09-15");
});

test("a Sunday game lands in the right week", () => {
  // Sunday 20 September 2026 is inside week 2 (15th to 22nd).
  assert.equal(weekOfKickoff(new Date("2026-09-20T17:00:00Z")), 2);
  // Sunday 27 September is week 3.
  assert.equal(weekOfKickoff(new Date("2026-09-27T17:00:00Z")), 3);
});

test("a Thursday opener lands in its own week, not the previous one", () => {
  // Thursday 17 September 2026, week 2's Thursday night game.
  assert.equal(weekOfKickoff(new Date("2026-09-17T00:20:00Z")), 2);
});

test("a Monday night game stays in its own week", () => {
  // Monday 21 September, late -- still week 2, not week 3.
  assert.equal(weekOfKickoff(new Date("2026-09-22T00:15:00Z")), 2);
});

test("week 1 covers the season opener", () => {
  // Thursday 10 September 2026 is before the week 2 rollover, so week 1.
  assert.equal(weekOfKickoff(new Date("2026-09-11T00:20:00Z")), 1);
});

test("dates outside the season belong to no week", () => {
  assert.equal(weekOfKickoff(new Date("2026-03-01T00:00:00Z")), null);
  assert.equal(weekOfKickoff(new Date("2027-08-01T00:00:00Z")), null);
});

test("weekWindow clamps rather than running off the season", () => {
  assert.deepEqual(weekWindow(0), weekWindow(1));
  assert.deepEqual(weekWindow(99), weekWindow(18));
});
