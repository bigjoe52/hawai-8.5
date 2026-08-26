import { sql } from "./db.ts";
import { getMatchups } from "./sleeper.ts";
import { gradeBet, type MarketKind, type Pick } from "./grading.ts";
import { currentWeek } from "./week.ts";

/**
 * Grading matched bets from the final fantasy scores.
 *
 * A week counts as finished once the league has rolled past it -- our own
 * schedule decides that, so there is no guessing about whether Sleeper
 * considers the games over.
 *
 * Only bets placed off the generated board carry the market data needed to
 * grade them. Hand-written bets are left for the commissioner.
 */

type Gradeable = {
  id: number;
  market_kind: MarketKind;
  line_value: string | number | null;
  proposer_pick: Pick;
  home_roster_id: number | null;
  away_roster_id: number | null;
  subject_roster_id: number | null;
};

export type SettleReport = {
  graded: number;
  pushed: number;
  skipped: number;
  error?: string;
};

/**
 * Grade every matched bet from a finished week that has the data to be graded.
 *
 * Idempotent and safe to run concurrently: the UPDATE only matches rows still
 * in `matched`, so two simultaneous runs cannot settle the same bet twice.
 */
export async function autoSettleWeek(
  season: number,
  week: number,
): Promise<SettleReport> {
  const leagueId = process.env.SLEEPER_LEAGUE_ID;
  if (!leagueId) return { graded: 0, pushed: 0, skipped: 0 };

  const pending = (await sql`
    SELECT id, market_kind, line_value, proposer_pick,
           home_roster_id, away_roster_id, subject_roster_id
    FROM side_bets
    WHERE season = ${season} AND week = ${week}
      AND status = 'matched'
      AND market_kind IS NOT NULL
      AND proposer_pick IS NOT NULL
  `) as Gradeable[];

  if (pending.length === 0) return { graded: 0, pushed: 0, skipped: 0 };

  const matchups = await getMatchups(leagueId, week);
  if (!matchups.ok) {
    return { graded: 0, pushed: 0, skipped: pending.length, error: matchups.error };
  }

  const pointsByRoster = new Map(matchups.data.map((m) => [m.rosterId, m.points]));

  let graded = 0;
  let pushed = 0;
  let skipped = 0;

  for (const bet of pending) {
    const homePoints = bet.home_roster_id !== null
      ? pointsByRoster.get(bet.home_roster_id)
      : undefined;
    const awayPoints = bet.away_roster_id !== null
      ? pointsByRoster.get(bet.away_roster_id)
      : undefined;

    if (homePoints === undefined || awayPoints === undefined) {
      skipped += 1;
      continue;
    }

    const subjectPoints = bet.subject_roster_id !== null
      ? pointsByRoster.get(bet.subject_roster_id)
      : undefined;

    const outcome = gradeBet(
      {
        kind: bet.market_kind,
        // NUMERIC comes back from Postgres as a string.
        line: Number(bet.line_value ?? 0),
        pick: bet.proposer_pick,
      },
      { homePoints, awayPoints, subjectPoints },
    );

    if (outcome === null) {
      skipped += 1;
      continue;
    }

    // A push moves no money, so it goes straight to void rather than unpaid.
    const status = outcome === "push" ? "void" : "unpaid";

    const updated = await sql`
      UPDATE side_bets
      SET winner = ${outcome},
          status = ${status},
          auto_settled = TRUE,
          settled_at = NOW()
      WHERE id = ${bet.id} AND status = 'matched'
      RETURNING id
    `;

    if (updated.length === 0) {
      // Somebody else settled it between the read and the write.
      skipped += 1;
    } else if (outcome === "push") {
      pushed += 1;
    } else {
      graded += 1;
    }
  }

  return { graded, pushed, skipped };
}

/**
 * Grade anything outstanding from weeks that have already finished.
 *
 * Called when the side bets or commissioner page is loaded, so results appear
 * on their own without anybody pressing a button. Only looks back a few weeks
 * -- an old unsettled bet needs a human, not another API call every page load.
 */
export async function autoSettleFinishedWeeks(lookback = 3): Promise<SettleReport> {
  const { season, week } = currentWeek();
  const total: SettleReport = { graded: 0, pushed: 0, skipped: 0 };

  // week - 1 is the most recent finished week; week itself is still live.
  for (let w = week - 1; w >= Math.max(1, week - lookback); w--) {
    const report = await autoSettleWeek(season, w);
    total.graded += report.graded;
    total.pushed += report.pushed;
    total.skipped += report.skipped;
    if (report.error && !total.error) total.error = report.error;
  }

  return total;
}
