/**
 * Who owes who.
 *
 * Money is settled offline (Venmo, cash, whatever) -- the site's only job is
 * to be the agreed-upon record of what the number is. Pure functions, no I/O.
 */

export type SettledBet = {
  id: number;
  proposerId: number;
  takerId: number;
  stakeCents: number;
  winner: "proposer" | "taker" | "push";
};

export type Debt = {
  fromUserId: number;
  toUserId: number;
  cents: number;
};

/**
 * Net profit/loss per user across all settled side bets.
 * Winners are positive, losers negative. Pushes move nothing.
 *
 * The totals across all users always sum to zero -- every dollar won by
 * someone was lost by someone else. `assertBalanced` checks that invariant.
 */
export function netByUser(bets: SettledBet[]): Map<number, number> {
  const net = new Map<number, number>();
  const bump = (userId: number, delta: number) => {
    net.set(userId, (net.get(userId) ?? 0) + delta);
  };

  for (const bet of bets) {
    // Make sure both players appear in the standings even at 0.
    bump(bet.proposerId, 0);
    bump(bet.takerId, 0);
    if (bet.winner === "push") continue;

    const winnerId = bet.winner === "proposer" ? bet.proposerId : bet.takerId;
    const loserId = bet.winner === "proposer" ? bet.takerId : bet.proposerId;
    bump(winnerId, bet.stakeCents);
    bump(loserId, -bet.stakeCents);
  }

  return net;
}

/**
 * Net out every pair of players into a single debt each.
 *
 * If Joe beat Mike for $20 and Mike beat Joe for $5, this reports one debt:
 * Mike owes Joe $15. Ten separate "you owe me five bucks" arguments become one
 * number, which is the entire point.
 */
export function pairwiseDebts(bets: SettledBet[]): Debt[] {
  // Key is "lowUserId:highUserId" so both directions land in the same bucket.
  const pairs = new Map<string, number>();

  for (const bet of bets) {
    if (bet.winner === "push") continue;
    const winnerId = bet.winner === "proposer" ? bet.proposerId : bet.takerId;
    const loserId = bet.winner === "proposer" ? bet.takerId : bet.proposerId;

    const [low, high] = winnerId < loserId ? [winnerId, loserId] : [loserId, winnerId];
    const key = `${low}:${high}`;
    // Positive means `low` is up on `high`.
    const delta = winnerId === low ? bet.stakeCents : -bet.stakeCents;
    pairs.set(key, (pairs.get(key) ?? 0) + delta);
  }

  const debts: Debt[] = [];
  for (const [key, balance] of pairs) {
    if (balance === 0) continue; // dead even, nothing to settle
    const [low, high] = key.split(":").map(Number);
    debts.push(
      balance > 0
        ? { fromUserId: high, toUserId: low, cents: balance }
        : { fromUserId: low, toUserId: high, cents: -balance },
    );
  }

  // Biggest debts first -- those are the ones people care about.
  return debts.sort((a, b) => b.cents - a.cents);
}

/**
 * Sanity check: all the net positions must sum to exactly zero.
 * If this ever fails, the ledger has a bug and should not be trusted.
 */
export function assertBalanced(net: Map<number, number>): void {
  let sum = 0;
  for (const value of net.values()) sum += value;
  if (sum !== 0) {
    throw new Error(`ledger does not balance: net sums to ${sum} cents, expected 0`);
  }
}

export type StandingRow = {
  userId: number;
  netCents: number;
  wins: number;
  losses: number;
  pushes: number;
};

/** Leaderboard rows: net money first, then win count. */
export function standings(bets: SettledBet[]): StandingRow[] {
  const net = netByUser(bets);
  const rows = new Map<number, StandingRow>();

  const row = (userId: number): StandingRow => {
    let existing = rows.get(userId);
    if (!existing) {
      existing = { userId, netCents: net.get(userId) ?? 0, wins: 0, losses: 0, pushes: 0 };
      rows.set(userId, existing);
    }
    return existing;
  };

  for (const bet of bets) {
    const proposer = row(bet.proposerId);
    const taker = row(bet.takerId);
    if (bet.winner === "push") {
      proposer.pushes += 1;
      taker.pushes += 1;
    } else if (bet.winner === "proposer") {
      proposer.wins += 1;
      taker.losses += 1;
    } else {
      taker.wins += 1;
      proposer.losses += 1;
    }
  }

  return [...rows.values()].sort(
    (a, b) => b.netCents - a.netCents || b.wins - a.wins || a.userId - b.userId,
  );
}
