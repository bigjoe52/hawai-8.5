import { test } from "node:test";
import assert from "node:assert/strict";
import {
  netByUser,
  pairwiseDebts,
  assertBalanced,
  standings,
  type SettledBet,
} from "../src/lib/ledger.ts";

let nextId = 1;

/** A straight-up bet: both sides put up the same amount. */
const bet = (
  proposerId: number,
  takerId: number,
  stakeCents: number,
  winner: SettledBet["winner"],
): SettledBet => ({
  id: nextId++,
  proposerId,
  takerId,
  stakeCents,
  takerStakeCents: stakeCents,
  winner,
});

/** A priced bet: the two sides put up different amounts. */
const priced = (
  proposerId: number,
  takerId: number,
  stakeCents: number,
  takerStakeCents: number,
  winner: SettledBet["winner"],
): SettledBet => ({
  id: nextId++,
  proposerId,
  takerId,
  stakeCents,
  takerStakeCents,
  winner,
});

test("winner gains the stake, loser drops it", () => {
  const net = netByUser([bet(1, 2, 2000, "proposer")]);
  assert.equal(net.get(1), 2000);
  assert.equal(net.get(2), -2000);
});

test("a push moves no money but both players still appear", () => {
  const net = netByUser([bet(1, 2, 2000, "push")]);
  assert.equal(net.get(1), 0);
  assert.equal(net.get(2), 0);
});

test("the ledger always balances to zero", () => {
  const bets = [
    bet(1, 2, 2000, "proposer"),
    bet(2, 3, 500, "taker"),
    bet(3, 1, 7500, "proposer"),
    bet(1, 4, 1000, "push"),
    bet(4, 2, 300, "taker"),
  ];
  assertBalanced(netByUser(bets));
});

test("assertBalanced actually catches a broken ledger", () => {
  const broken = new Map([
    [1, 500],
    [2, -400],
  ]);
  assert.throws(() => assertBalanced(broken), /does not balance/);
});

test("opposing bets between two players net into one debt", () => {
  // Joe(1) beat Mike(2) for $20; Mike beat Joe for $5. Mike owes Joe $15.
  const debts = pairwiseDebts([
    bet(1, 2, 2000, "proposer"),
    bet(2, 1, 500, "proposer"),
  ]);
  assert.equal(debts.length, 1);
  assert.deepEqual(debts[0], { fromUserId: 2, toUserId: 1, cents: 1500 });
});

test("players who are dead even owe nothing", () => {
  const debts = pairwiseDebts([
    bet(1, 2, 2000, "proposer"),
    bet(1, 2, 2000, "taker"),
  ]);
  assert.deepEqual(debts, []);
});

test("debt direction is right regardless of who posted the bet", () => {
  // The taker won, so the proposer owes.
  const debts = pairwiseDebts([bet(7, 3, 1000, "taker")]);
  assert.deepEqual(debts, [{ fromUserId: 7, toUserId: 3, cents: 1000 }]);
});

test("separate pairs are tracked separately, biggest debt first", () => {
  const debts = pairwiseDebts([
    bet(1, 2, 500, "proposer"),
    bet(3, 4, 9000, "proposer"),
    bet(1, 3, 2500, "taker"),
  ]);
  assert.equal(debts.length, 3);
  assert.equal(debts[0].cents, 9000);
  assert.deepEqual(
    debts.map((d) => d.cents),
    [9000, 2500, 500],
  );
});

test("pairwise debts and net positions agree with each other", () => {
  const bets = [
    bet(1, 2, 2000, "proposer"),
    bet(2, 3, 1500, "taker"),
    bet(1, 3, 800, "taker"),
    bet(2, 1, 400, "proposer"),
  ];
  const net = netByUser(bets);
  const fromDebts = new Map<number, number>();
  for (const userId of net.keys()) fromDebts.set(userId, 0);
  for (const d of pairwiseDebts(bets)) {
    fromDebts.set(d.fromUserId, (fromDebts.get(d.fromUserId) ?? 0) - d.cents);
    fromDebts.set(d.toUserId, (fromDebts.get(d.toUserId) ?? 0) + d.cents);
  }
  assert.deepEqual([...fromDebts].sort(), [...net].sort());
});

test("standings rank by money, and count W/L/P correctly", () => {
  const rows = standings([
    bet(1, 2, 5000, "proposer"),
    bet(1, 3, 1000, "proposer"),
    bet(2, 3, 2000, "proposer"),
    bet(1, 2, 500, "push"),
  ]);
  assert.equal(rows[0].userId, 1);
  assert.equal(rows[0].netCents, 6000);
  assert.equal(rows[0].wins, 2);
  assert.equal(rows[0].pushes, 1);

  const mike = rows.find((r) => r.userId === 2)!;
  assert.equal(mike.wins, 1);
  assert.equal(mike.losses, 1);
  assert.equal(mike.pushes, 1);
  assert.equal(mike.netCents, -3000);

  // Last place is the biggest loser.
  assert.equal(rows[rows.length - 1].userId, 3);
});

test("empty ledger is handled without blowing up", () => {
  assert.deepEqual(standings([]), []);
  assert.deepEqual(pairwiseDebts([]), []);
  assertBalanced(netByUser([]));
});

/* --- Priced (moneyline) bets, where the two sides risk different amounts --- */

test("the winner collects what the LOSER risked, not their own stake", () => {
  // Joe backs a favourite: puts up $5.00 to win $1.79.
  const joeWins = netByUser([priced(1, 2, 500, 179, "proposer")]);
  assert.equal(joeWins.get(1), 179, "Joe collects the underdog's $1.79");
  assert.equal(joeWins.get(2), -179);

  // Same bet, the other result: Joe loses the $5.00 he put up.
  const mikeWins = netByUser([priced(1, 2, 500, 179, "taker")]);
  assert.equal(mikeWins.get(1), -500);
  assert.equal(mikeWins.get(2), 500, "Mike collects the favourite's $5.00");
});

test("a priced ledger still balances to zero", () => {
  assertBalanced(
    netByUser([
      priced(1, 2, 500, 179, "proposer"),
      priced(2, 3, 500, 1400, "taker"),
      priced(3, 1, 250, 900, "proposer"),
      bet(1, 4, 1000, "taker"),
    ]),
  );
});

test("pairwise debts use the amount actually owed", () => {
  const debts = pairwiseDebts([priced(1, 2, 500, 179, "proposer")]);
  assert.deepEqual(debts, [{ fromUserId: 2, toUserId: 1, cents: 179 }]);
});

test("a big underdog win outweighs several favourite wins", () => {
  // Joe wins three favourite bets at $1.79 each, then loses one dog bet at $14.
  const debts = pairwiseDebts([
    priced(1, 2, 500, 179, "proposer"),
    priced(1, 2, 500, 179, "proposer"),
    priced(1, 2, 500, 179, "proposer"),
    priced(1, 2, 500, 1400, "taker"),
  ]);
  // 537 collected, 500 paid out... wait: he loses his own 500 on the last one.
  // 179 * 3 = 537 in, 500 out => Joe up 37.
  assert.deepEqual(debts, [{ fromUserId: 2, toUserId: 1, cents: 37 }]);
});

test("standings count a priced win as one win, whatever the amount", () => {
  const rows = standings([
    priced(1, 2, 500, 179, "proposer"),
    priced(1, 2, 500, 1400, "taker"),
  ]);
  const joe = rows.find((r) => r.userId === 1)!;
  assert.equal(joe.wins, 1);
  assert.equal(joe.losses, 1);
  // Won $1.79, lost $5.00.
  assert.equal(joe.netCents, 179 - 500);
});

test("straight-up and priced bets mix correctly in one ledger", () => {
  const bets = [
    bet(1, 2, 500, "proposer"),            // Joe +500
    priced(1, 2, 500, 179, "taker"),       // Joe -500
    priced(2, 1, 250, 750, "proposer"),    // Mike +750, Joe -750
  ];
  const net = netByUser(bets);
  assert.equal(net.get(1), 500 - 500 - 750);
  assert.equal(net.get(2), -500 + 500 + 750);
  assertBalanced(net);
});
