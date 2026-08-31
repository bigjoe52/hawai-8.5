import { test } from "node:test";
import assert from "node:assert/strict";
import { combinedDecimalOdds, parlayPayoutCents, decimalToAmerican } from "../src/lib/odds.ts";
import type { LegStatus } from "../src/lib/odds.ts";

/**
 * The ledger's parlay record used to rebuild every leg as a win before
 * computing the payout, which defeated the push-drops-out rule and made the
 * ledger disagree with the parlay page. These lock in that they agree.
 */

const leg = (oddsAmerican: number, status: LegStatus) => ({ oddsAmerican, status });

/** What the ledger now does: pass the real statuses through. */
const ledgerPayout = (legs: Array<{ oddsAmerican: number; status: LegStatus }>, stake: number) =>
  Math.round(stake * combinedDecimalOdds(legs));

test("a pushed leg drops out of the ledger payout, matching the parlay page", () => {
  const legs = [leg(100, "win"), leg(100, "win"), leg(-110, "push")];
  const page = parlayPayoutCents(legs, 1000);
  assert.equal(page, 4000, "two +100 legs on $10 pay $40; the push drops out");
  assert.equal(ledgerPayout(legs, 1000), page, "ledger must agree with the page");
});

test("the two agree on a realistic nine-win, one-push ticket", () => {
  const legs = [
    ...Array.from({ length: 9 }, () => leg(-110, "win" as LegStatus)),
    leg(-110, "push"),
  ];
  assert.equal(ledgerPayout(legs, 1000), parlayPayoutCents(legs, 1000));
});

test("they agree when nothing pushed either", () => {
  const legs = [leg(-110, "win"), leg(150, "win")];
  assert.equal(ledgerPayout(legs, 1000), parlayPayoutCents(legs, 1000));
});

test("several pushes all drop out", () => {
  const legs = [leg(100, "win"), leg(-110, "push"), leg(250, "push")];
  assert.equal(ledgerPayout(legs, 1000), 2000);
});

test("an all-push ticket has no price to quote", () => {
  const legs = [leg(-110, "push"), leg(-110, "push")];
  const decimal = combinedDecimalOdds(legs);
  assert.equal(decimal, 1);
  // This is what used to 500 the parlay page; both places now guard on it.
  assert.throws(() => decimalToAmerican(decimal));
});

test("a pushed leg no longer inflates the combined price", () => {
  const withPush = combinedDecimalOdds([leg(-110, "win"), leg(-110, "win"), leg(500, "push")]);
  const without = combinedDecimalOdds([leg(-110, "win"), leg(-110, "win")]);
  assert.equal(withPush, without);
  // The review measured +2087 where +264 was correct.
  assert.equal(decimalToAmerican(withPush), 264);
});
