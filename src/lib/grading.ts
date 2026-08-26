/**
 * Deciding who won a bet from the final fantasy scores.
 *
 * Only bets placed off the generated board can be graded here: they carry the
 * market type, the number, and which side the proposer took. A bet somebody
 * typed out in their own words stays for the commissioner to settle by hand,
 * because there is no way to read "whoever benches the worst guy" in code.
 *
 * Pure functions. No I/O.
 */

export type MarketKind = "moneyline" | "spread" | "total" | "team_total";
export type Pick = "home" | "away" | "over" | "under";
export type Outcome = "proposer" | "taker" | "push";

export type GradeableBet = {
  kind: MarketKind;
  /** The number the bet was struck at. Ignored for a moneyline. */
  line: number;
  /** Which side the person who posted it took. */
  pick: Pick;
};

export type FinalScores = {
  homePoints: number;
  awayPoints: number;
  /** The team the bet is about, for a team total. */
  subjectPoints?: number;
};

/**
 * Grade one bet.
 *
 * Returns null when the bet cannot be decided from these numbers -- a team
 * total with no subject score, or a pick that does not belong to the market.
 * Null means "leave it alone", never "nobody won".
 */
export function gradeBet(
  bet: GradeableBet,
  scores: FinalScores,
): Outcome | null {
  const { homePoints, awayPoints } = scores;
  if (!Number.isFinite(homePoints) || !Number.isFinite(awayPoints)) return null;

  switch (bet.kind) {
    case "moneyline": {
      if (bet.pick !== "home" && bet.pick !== "away") return null;
      if (homePoints === awayPoints) return "push";
      const homeWon = homePoints > awayPoints;
      return sideWon(bet.pick === "home" ? homeWon : !homeWon);
    }

    case "spread": {
      if (bet.pick !== "home" && bet.pick !== "away") return null;
      // `line` is how many points the home side is giving. The home side
      // covers when it wins by more than that.
      const margin = homePoints - awayPoints;
      if (margin === bet.line) return "push";
      const homeCovered = margin > bet.line;
      return sideWon(bet.pick === "home" ? homeCovered : !homeCovered);
    }

    case "total": {
      if (bet.pick !== "over" && bet.pick !== "under") return null;
      return overUnder(homePoints + awayPoints, bet.line, bet.pick);
    }

    case "team_total": {
      if (bet.pick !== "over" && bet.pick !== "under") return null;
      const points = scores.subjectPoints;
      if (typeof points !== "number" || !Number.isFinite(points)) return null;
      return overUnder(points, bet.line, bet.pick);
    }

    default:
      return null;
  }
}

function overUnder(actual: number, line: number, pick: "over" | "under"): Outcome {
  if (actual === line) return "push";
  const wentOver = actual > line;
  return sideWon(pick === "over" ? wentOver : !wentOver);
}

/** The proposer's side won, or it didn't. */
function sideWon(proposerWasRight: boolean): Outcome {
  return proposerWasRight ? "proposer" : "taker";
}

/**
 * Work out the market details to store when a bet is posted off the board.
 *
 * The board renders each market as two text labels; this turns the one that
 * was clicked back into something gradeable. Returns null for anything that
 * isn't a recognised market, which is how hand-written bets stay manual.
 */
export function describePick(
  kind: MarketKind,
  sideIndex: 0 | 1,
): Pick | null {
  switch (kind) {
    case "moneyline":
    case "spread":
      // The board always lists the home side first.
      return sideIndex === 0 ? "home" : "away";
    case "total":
    case "team_total":
      return sideIndex === 0 ? "over" : "under";
    default:
      return null;
  }
}
