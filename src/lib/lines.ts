/**
 * Turn projected scores into bettable lines.
 *
 * Pure functions, no I/O. Given two projected team totals, produce the three
 * markets people actually want: moneyline, spread, and totals.
 */

/**
 * Typical week-to-week spread of a fantasy team's score, in points.
 *
 * Projections tell you the average outcome; this is how much reality bounces
 * around it. Used to turn a points edge into a win probability. Around 25 is
 * about right for a full PPR lineup.
 */
export const SCORE_STDEV = 25;

/** Longest price we will ever show, so a blowout mismatch stays readable. */
const MAX_ODDS = 2000;

export type TeamLine = {
  rosterId: number;
  name: string;
  projected: number;
};

export type Market = {
  kind: "moneyline" | "spread" | "total" | "team_total";
  title: string;
  /** The two sides, always exactly two. */
  sides: [string, string];
  /**
   * American odds for each side, or null for a straight-up bet.
   *
   * Only the moneyline carries a price. Spreads and totals are set at the
   * projected number, which makes both sides a coin flip, so they are settled
   * straight up: the loser pays the winner the stake.
   */
  odds: [number, number] | null;
};

/** Round to the nearest half point, the way real lines are quoted. */
export function toHalfPoint(value: number): number {
  return Math.round(value * 2) / 2;
}

/**
 * Standard normal CDF via the Abramowitz & Stegun 7.1.26 error-function
 * approximation. Accurate to about 1e-7, which is far more than a $5 bet needs.
 */
export function normalCdf(z: number): number {
  // The approximation below lands a hair off 0.5 at z = 0; say it exactly, so
  // an evenly matched game prices as a clean pick'em.
  if (z === 0) return 0.5;
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t +
      0.254829592) *
      t *
      Math.exp(-x * x);
  return 0.5 * (1 + sign * y);
}

/**
 * Probability that a team projected for `a` beats one projected for `b`.
 *
 * Both scores are treated as normal with the same spread, so their difference
 * is normal with standard deviation sqrt(2) * SCORE_STDEV.
 */
export function winProbability(a: number, b: number, stdev = SCORE_STDEV): number {
  const diffStdev = Math.sqrt(2) * stdev;
  if (diffStdev <= 0) return a === b ? 0.5 : a > b ? 1 : 0;
  return normalCdf((a - b) / diffStdev);
}

/** Convert a probability to American odds, rounded to a realistic increment. */
export function probabilityToAmerican(probability: number): number {
  const p = Math.min(Math.max(probability, 0.0001), 0.9999);
  // A coin flip is even money. Without this it lands on -100 for one side and
  // +100 for the other -- the same price written two different ways, which
  // reads like a mistake.
  if (Math.abs(p - 0.5) < 1e-9) return 100;
  const raw = p >= 0.5 ? (-100 * p) / (1 - p) : (100 * (1 - p)) / p;
  // Quote to the nearest 5, like a real book.
  const rounded = Math.round(raw / 5) * 5;
  const clamped = Math.max(Math.min(rounded, MAX_ODDS), -MAX_ODDS);
  // Nothing sits between -100 and +100; nudge a true coin flip to -105/-105.
  if (clamped > -100 && clamped < 100) return -105;
  return clamped;
}

/**
 * Price both sides of a two-way market at fair odds.
 *
 * No vig. Nobody is running a book here -- these are ten friends betting each
 * other directly, so the two prices reflect the projected probabilities and
 * nothing else. The implied probabilities add up to 100%, give or take the
 * rounding to the nearest 5.
 */
export function priceTwoWay(probabilityA: number): [number, number] {
  return [
    probabilityToAmerican(probabilityA),
    probabilityToAmerican(1 - probabilityA),
  ];
}

/* -------------------------------------------------------------------------
 * Who owes what
 * ---------------------------------------------------------------------- */

/**
 * What you collect if your side wins, given what you put up.
 *
 *   -280 risking $5.00  ->  wins $1.79   (lay 280 to win 100)
 *   +280 risking $5.00  ->  wins $14.00  (risk 100 to win 280)
 *
 * In a head-to-head bet this is also exactly what the *other* person is
 * risking: whatever you stand to win, they stand to lose, and vice versa.
 */
export function winningsFor(american: number, riskCents: number): number {
  if (!Number.isInteger(riskCents) || riskCents <= 0) {
    throw new Error(`risk must be a positive whole number of cents, got ${riskCents}`);
  }
  const ratio = american > 0 ? american / 100 : 100 / Math.abs(american);
  // Never round a real bet down to nothing.
  return Math.max(1, Math.round(riskCents * ratio));
}

/**
 * Both halves of a head-to-head bet: what each person puts up, and therefore
 * what each collects from the other.
 *
 * The person taking `american` risks `riskCents`. The other person risks what
 * the first stands to win. Whoever loses pays what they risked.
 */
export function headToHead(
  american: number | null,
  riskCents: number,
): { yourRisk: number; theirRisk: number } {
  // An even-money bet is straight up: same amount on both sides.
  if (american === null) return { yourRisk: riskCents, theirRisk: riskCents };
  return { yourRisk: riskCents, theirRisk: winningsFor(american, riskCents) };
}

/** Format a spread the way it is spoken: "-6.5" for the favourite. */
export function formatSpread(points: number): string {
  if (points === 0) return "PK"; // pick'em
  return points > 0 ? `+${points}` : String(points);
}

/**
 * Build every market for one matchup.
 *
 * `home` and `away` are just the two sides; there is no home-field advantage
 * in fantasy, so the labels are only for display order.
 */
export function buildMarkets(home: TeamLine, away: TeamLine): Market[] {
  const markets: Market[] = [];

  // --- Moneyline: who simply wins ---
  const pHome = winProbability(home.projected, away.projected);
  markets.push({
    kind: "moneyline",
    title: "Moneyline",
    sides: [home.name, away.name],
    odds: priceTwoWay(pHome),
  });

  // --- Spread: margin of victory ---
  // The line is set at the projected margin, which makes both sides a coin
  // flip by construction. So these are straight-up bets with no price on
  // them: loser pays winner the stake.
  const line = toHalfPoint(home.projected - away.projected);
  markets.push({
    kind: "spread",
    title: "Spread",
    sides: [
      `${home.name} ${formatSpread(-line)}`,
      `${away.name} ${formatSpread(line)}`,
    ],
    odds: null,
  });

  // --- Game total ---
  const total = toHalfPoint(home.projected + away.projected);
  markets.push({
    kind: "total",
    title: "Game total",
    sides: [`Over ${total}`, `Under ${total}`],
    odds: null,
  });

  // --- Each team's own total ---
  for (const team of [home, away]) {
    const teamTotal = toHalfPoint(team.projected);
    markets.push({
      kind: "team_total",
      title: `${team.name} total`,
      sides: [`Over ${teamTotal}`, `Under ${teamTotal}`],
      odds: null,
    });
  }

  return markets;
}
