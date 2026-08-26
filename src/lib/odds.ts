/**
 * Betting math for the league.
 *
 * Everything in here is a pure function with no database or network access,
 * which is exactly why it is the part that gets unit tested hardest -- real
 * money is tracked against these numbers.
 *
 * Money is always integer CENTS. Never floats: 0.1 + 0.2 !== 0.3 in binary
 * floating point, and that error compounds across a season of bets.
 */

export type LegStatus = "pending" | "win" | "loss" | "push";
export type ParlayStatus = "open" | "locked" | "won" | "lost";

export type Leg = {
  oddsAmerican: number;
  status: LegStatus;
};

/**
 * American odds -> decimal multiplier.
 *
 *   +250  ->  3.5   (bet 100, get back 350)
 *   -110  ->  1.909 (bet 110, get back 210)
 *
 * Decimal odds INCLUDE the returned stake, which is what makes them easy to
 * multiply together for a parlay.
 */
export function americanToDecimal(odds: number): number {
  if (!Number.isFinite(odds)) {
    throw new Error(`odds must be a finite number, got ${odds}`);
  }
  // Odds between -100 and +100 are not expressible in American format.
  if (odds >= -99 && odds <= 99) {
    throw new Error(
      `American odds cannot be between -100 and +100 (got ${odds})`,
    );
  }
  return odds > 0 ? odds / 100 + 1 : 100 / Math.abs(odds) + 1;
}

/** Decimal odds -> American, for displaying a combined parlay price. */
export function decimalToAmerican(decimal: number): number {
  if (decimal <= 1) {
    throw new Error(`decimal odds must be > 1, got ${decimal}`);
  }
  const american =
    decimal >= 2 ? (decimal - 1) * 100 : -100 / (decimal - 1);
  return Math.round(american);
}

/**
 * Combined decimal odds for a parlay.
 *
 * Pushed legs are removed from the parlay rather than killing it -- that is
 * the standard sportsbook rule, and it is the one people expect. A pushed leg
 * multiplies by 1.0, so it just drops out.
 *
 * Losing legs are NOT special-cased here; a parlay with any loser pays zero,
 * which `parlayPayoutCents` handles.
 */
export function combinedDecimalOdds(legs: Leg[]): number {
  return legs.reduce((acc, leg) => {
    if (leg.status === "push") return acc;
    return acc * americanToDecimal(leg.oddsAmerican);
  }, 1);
}

/**
 * Resolve the parlay from its legs.
 *
 * - Any single loss kills it immediately, even if other legs are still pending.
 *   (This is real: once a leg loses, the ticket is dead.)
 * - Every leg must be graded before it can be declared a winner.
 * - An empty parlay, or one that is all pushes, is not a win -- there is
 *   nothing to pay out on.
 */
export function resolveParlay(legs: Leg[]): "won" | "lost" | "pending" {
  if (legs.some((l) => l.status === "loss")) return "lost";
  if (legs.some((l) => l.status === "pending")) return "pending";
  if (legs.length === 0) return "pending";
  if (legs.every((l) => l.status === "push")) return "lost";
  return "won";
}

/**
 * What the ticket returns, in cents, INCLUDING the original stake.
 * Returns 0 if the parlay lost or is not yet decided.
 */
export function parlayPayoutCents(legs: Leg[], stakeCents: number): number {
  assertWholeCents(stakeCents);
  if (resolveParlay(legs) !== "won") return 0;
  return Math.round(stakeCents * combinedDecimalOdds(legs));
}

/** Profit only -- payout minus what was put in. Negative when the ticket loses. */
export function parlayProfitCents(legs: Leg[], stakeCents: number): number {
  assertWholeCents(stakeCents);
  const outcome = resolveParlay(legs);
  if (outcome === "pending") return 0;
  if (outcome === "lost") return -stakeCents;
  return parlayPayoutCents(legs, stakeCents) - stakeCents;
}

function assertWholeCents(cents: number): void {
  if (!Number.isInteger(cents) || cents < 0) {
    throw new Error(`stake must be a non-negative whole number of cents, got ${cents}`);
  }
}

/** "$12.50" from 1250. Used everywhere money is shown. */
export function formatCents(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const body = `$${Math.floor(abs / 100).toLocaleString()}.${String(abs % 100).padStart(2, "0")}`;
  return negative ? `-${body}` : body;
}

/** "+250" / "-110" -- American odds always carry an explicit sign. */
export function formatAmerican(odds: number): string {
  return odds > 0 ? `+${odds}` : String(odds);
}

/** Parse a user-typed stake like "$25", "25.50", "25" into cents. */
export function parseStakeToCents(input: string): number {
  const cleaned = input.trim().replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) {
    throw new Error(`"${input}" is not a valid dollar amount`);
  }
  const [dollars, fraction = ""] = cleaned.split(".");
  return Number(dollars) * 100 + Number(fraction.padEnd(2, "0"));
}
