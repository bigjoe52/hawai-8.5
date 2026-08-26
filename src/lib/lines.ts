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

/** House edge baked into the moneylines, so the two prices aren't a pure coin flip. */
export const VIG = 0.04;

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
  /** Odds for each side, American. Null for even-money propositions. */
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
  const raw = p >= 0.5 ? (-100 * p) / (1 - p) : (100 * (1 - p)) / p;
  // Quote to the nearest 5, like a real book.
  const rounded = Math.round(raw / 5) * 5;
  const clamped = Math.max(Math.min(rounded, MAX_ODDS), -MAX_ODDS);
  // Nothing sits between -100 and +100; nudge a true coin flip to -105/-105.
  if (clamped > -100 && clamped < 100) return -105;
  return clamped;
}

/**
 * Price both sides of a two-way market, with the vig split evenly.
 *
 * Raising each side's implied probability by half the vig means the two prices
 * add up to slightly more than 100%, which is what makes it a market rather
 * than a coin flip.
 */
export function priceTwoWay(
  probabilityA: number,
  vig = VIG,
): [number, number] {
  const a = Math.min(probabilityA + vig / 2, 0.999);
  const b = Math.min(1 - probabilityA + vig / 2, 0.999);
  return [probabilityToAmerican(a), probabilityToAmerican(b)];
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

  // --- Spread: margin of victory, priced near even on both sides ---
  const rawEdge = home.projected - away.projected;
  const line = toHalfPoint(rawEdge);
  markets.push({
    kind: "spread",
    title: "Spread",
    sides: [
      `${home.name} ${formatSpread(-line)}`,
      `${away.name} ${formatSpread(line)}`,
    ],
    // A fair spread makes both sides roughly a coin flip, so both get -110.
    odds: [-110, -110],
  });

  // --- Game total ---
  const total = toHalfPoint(home.projected + away.projected);
  markets.push({
    kind: "total",
    title: "Game total",
    sides: [`Over ${total}`, `Under ${total}`],
    odds: [-110, -110],
  });

  // --- Each team's own total ---
  for (const team of [home, away]) {
    const teamTotal = toHalfPoint(team.projected);
    markets.push({
      kind: "team_total",
      title: `${team.name} total`,
      sides: [`Over ${teamTotal}`, `Under ${teamTotal}`],
      odds: [-110, -110],
    });
  }

  return markets;
}
