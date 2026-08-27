/**
 * Ranking members by how their parlay legs have gone.
 *
 * Pure functions so the ordering and the roasting rules can be tested without
 * a database.
 */

import type { LegRecord } from "./queries.ts";

export type RankedLeg = LegRecord & {
  /** Legs actually decided. Pending and pushes don't count either way. */
  decided: number;
  /** Wins as a share of decided legs, or null with nothing decided yet. */
  hitRate: number | null;
  /** Last place, and enough legs in that it means something. */
  isWorst: boolean;
};

/**
 * Below this, a bad run is just a bad run. Branding somebody the league's
 * worst off two legs would be unfair, and worse, unfunny.
 */
export const ROAST_THRESHOLD = 3;

export function rankLegRecords(records: LegRecord[]): RankedLeg[] {
  const ranked: RankedLeg[] = records.map((r) => {
    const decided = r.wins + r.losses;
    return {
      ...r,
      decided,
      hitRate: decided > 0 ? r.wins / decided : null,
      isWorst: false,
    };
  });

  ranked.sort((a, b) => {
    // Anyone with nothing decided sits at the bottom, unranked.
    if (a.hitRate === null && b.hitRate === null) {
      return a.displayName.localeCompare(b.displayName);
    }
    if (a.hitRate === null) return 1;
    if (b.hitRate === null) return -1;

    if (b.hitRate !== a.hitRate) return b.hitRate - a.hitRate;
    // Same rate: more wins is better, then fewer solo busts.
    if (b.wins !== a.wins) return b.wins - a.wins;
    if (a.soloBusts !== b.soloBusts) return a.soloBusts - b.soloBusts;
    return a.displayName.localeCompare(b.displayName);
  });

  // Flag the worst, but only once somebody has a real sample.
  const eligible = ranked.filter(
    (r) => r.hitRate !== null && r.decided >= ROAST_THRESHOLD,
  );
  if (eligible.length > 0) {
    const worst = eligible[eligible.length - 1];
    worst.isWorst = true;
  }

  return ranked;
}

/** "2-10", or "2-10-1" when there are pushes to account for. */
export function formatRecord(r: LegRecord): string {
  return r.pushes > 0
    ? `${r.wins}-${r.losses}-${r.pushes}`
    : `${r.wins}-${r.losses}`;
}

/** "17%" — whole numbers; nobody needs a decimal place on a 12-leg sample. */
export function formatHitRate(hitRate: number | null): string {
  return hitRate === null ? "—" : `${Math.round(hitRate * 100)}%`;
}
