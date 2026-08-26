"use client";

import { useState, useTransition } from "react";
import {
  buildMarkets,
  headToHead,
  type Market,
  type TeamLine,
} from "@/lib/lines.ts";
import { formatAmerican, formatCents, parseStakeToCents } from "@/lib/odds.ts";
import { postLineBetAction } from "@/lib/actions.ts";
import type { HeadToHead } from "@/lib/sleeper.ts";
import { describePick, type Pick } from "@/lib/grading.ts";

type Selection = {
  matchupId: number;
  title: string;
  mySide: string;
  theirSide: string;
  myOdds: number | null;
  matchup: string;
  /** Everything needed to grade this bet automatically once the week ends. */
  marketKind: Market["kind"];
  proposerPick: Pick;
  lineValue: number;
  homeRosterId: number;
  awayRosterId: number;
  subjectRosterId: number | null;
};

/** "$5.00" from a typed amount, or null while it is still nonsense. */
function centsOrNull(input: string): number | null {
  try {
    const cents = parseStakeToCents(input);
    return cents > 0 ? cents : null;
  } catch {
    return null;
  }
}

/**
 * The generated market board.
 *
 * Clicking a price opens a confirmation box rather than posting straight away
 * -- money is involved, and a misclick on a board this dense is easy. The box
 * is also where the stake gets set.
 */
export default function SuggestedLines({
  season,
  week,
  matchups,
  projections,
  scoringMethod = "league",
  defaultStake = "5",
}: {
  season: number;
  week: number;
  matchups: HeadToHead[];
  projections: Record<number, number>;
  /** "generic" means at least one starter fell back to Sleeper's own scoring. */
  scoringMethod?: "league" | "generic";
  defaultStake?: string;
}) {
  const [selection, setSelection] = useState<Selection | null>(null);

  const games = matchups.filter(
    (g) =>
      projections[g.home.rosterId] !== undefined &&
      projections[g.away.rosterId] !== undefined,
  );
  if (games.length === 0) return null;

  const label = (side: string, odds: number | null) =>
    odds === null ? side : `${side} (${formatAmerican(odds)})`;

  return (
    <>
      <div className="space-y-5">
        {games.map((game) => {
          const home: TeamLine = {
            rosterId: game.home.rosterId,
            name: game.home.teamName,
            projected: projections[game.home.rosterId],
          };
          const away: TeamLine = {
            rosterId: game.away.rosterId,
            name: game.away.teamName,
            projected: projections[game.away.rosterId],
          };
          const markets: Market[] = buildMarkets(home, away);
          const matchupLabel = `${home.name} vs ${away.name}`;

          return (
            <div
              key={game.matchupId}
              className="rounded-lg border border-white/10 bg-white/[0.02] p-4"
            >
              <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="font-medium text-white">
                  {home.name} <span className="text-white/30">vs</span> {away.name}
                </h3>
                <span className="font-mono text-xs text-white/40">
                  projected {home.projected.toFixed(1)} · {away.projected.toFixed(1)}
                </span>
              </div>

              <div className="space-y-2">
                {markets.map((market, i) => (
                  <div
                    key={i}
                    className="grid gap-2 rounded-md border border-white/5 bg-deep-900/40 p-2 sm:grid-cols-[110px_1fr_1fr] sm:items-center"
                  >
                    <span className="text-xs uppercase tracking-wide text-white/40">
                      {market.title}
                    </span>
                    {market.sides.map((side, sideIndex) => {
                      const other = sideIndex === 0 ? 1 : 0;
                      const myOdds = market.odds?.[sideIndex] ?? null;
                      const theirOdds = market.odds?.[other] ?? null;
                      return (
                        <button
                          key={side}
                          type="button"
                          onClick={() =>
                            setSelection({
                              matchupId: game.matchupId,
                              title: `${market.title}: ${matchupLabel}`,
                              mySide: label(side, myOdds),
                              theirSide: label(market.sides[other], theirOdds),
                              myOdds,
                              matchup: matchupLabel,
                              marketKind: market.kind,
                              proposerPick:
                                describePick(market.kind, sideIndex as 0 | 1) ?? "home",
                              lineValue: market.line,
                              homeRosterId: home.rosterId,
                              awayRosterId: away.rosterId,
                              subjectRosterId: market.subjectRosterId,
                            })
                          }
                          className="flex w-full items-center justify-between gap-2 rounded border border-white/10 px-3 py-1.5 text-left text-sm text-white/80 transition hover:border-surf-500 hover:bg-surf-500/10 hover:text-white"
                        >
                          <span className="truncate">{side}</span>
                          {myOdds !== null && (
                            <span className="shrink-0 font-mono text-xs text-sunset-300">
                              {formatAmerican(myOdds)}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <p className="mt-4 text-xs text-white/40">
        {scoringMethod === "league"
          ? "Projections are scored with your league's own scoring settings."
          : "Some players had no stat projection, so Sleeper's generic scoring was used for them. Totals may not match your league's settings exactly."}
      </p>

      {selection && (
        <ConfirmDialog
          selection={selection}
          season={season}
          week={week}
          defaultStake={defaultStake}
          onClose={() => setSelection(null)}
        />
      )}
    </>
  );
}

function ConfirmDialog({
  selection,
  season,
  week,
  defaultStake,
  onClose,
}: {
  selection: Selection;
  season: number;
  week: number;
  defaultStake: string;
  onClose: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [stake, setStake] = useState(defaultStake);

  const cents = centsOrNull(stake);
  const amounts = cents ? headToHead(selection.myOdds, cents) : null;
  const priced = selection.myOdds !== null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="w-full max-w-md rounded-xl border border-white/15 bg-deep-900 p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-semibold text-white">Post this bet?</h3>
        <p className="mt-1 text-sm text-white/50">{selection.matchup}</p>

        <div className="mt-4 space-y-2 text-sm">
          <div className="rounded-md border border-surf-500/30 bg-surf-500/5 px-3 py-2">
            <p className="text-xs uppercase tracking-wide text-white/40">
              You&apos;re taking
            </p>
            <p className="mt-0.5 text-white">{selection.mySide}</p>
          </div>
          <div className="rounded-md border border-white/10 bg-white/[0.02] px-3 py-2">
            <p className="text-xs uppercase tracking-wide text-white/40">
              They&apos;d be taking
            </p>
            <p className="mt-0.5 text-white/80">{selection.theirSide}</p>
          </div>
        </div>

        <form
          action={(formData) => {
            startTransition(async () => {
              await postLineBetAction(formData);
              onClose();
            });
          }}
          className="mt-4"
        >
          <input type="hidden" name="season" value={season} />
          <input type="hidden" name="week" value={week} />
          <input type="hidden" name="matchupId" value={String(selection.matchupId)} />
          <input type="hidden" name="title" value={selection.title} />
          <input type="hidden" name="proposerSide" value={selection.mySide} />
          <input type="hidden" name="takerSide" value={selection.theirSide} />
          <input type="hidden" name="marketKind" value={selection.marketKind} />
          <input type="hidden" name="proposerPick" value={selection.proposerPick} />
          <input type="hidden" name="lineValue" value={String(selection.lineValue)} />
          <input type="hidden" name="homeRosterId" value={String(selection.homeRosterId)} />
          <input type="hidden" name="awayRosterId" value={String(selection.awayRosterId)} />
          {selection.subjectRosterId !== null && (
            <input
              type="hidden"
              name="subjectRosterId"
              value={String(selection.subjectRosterId)}
            />
          )}
          <input
            type="hidden"
            name="odds"
            value={selection.myOdds === null ? "" : String(selection.myOdds)}
          />

          <label htmlFor="line-stake" className="mb-1.5 block text-sm text-white/70">
            {priced ? "What you put up" : "Stake"}
          </label>
          <input
            id="line-stake"
            name="stake"
            value={stake}
            onChange={(e) => setStake(e.target.value)}
            inputMode="decimal"
            autoFocus
            className="w-full rounded-md border border-white/15 bg-deep-950 px-3 py-2 font-mono text-sm text-white focus:border-surf-500 focus:outline-none"
          />

          {/* The whole point: say plainly who pays who, and how much. */}
          <div className="mt-3 rounded-md border border-white/10 bg-white/[0.02] px-3 py-2.5 text-sm">
            {amounts === null ? (
              <p className="text-white/40">Enter a dollar amount.</p>
            ) : priced ? (
              <>
                <p className="text-white/80">
                  If you win, they owe you{" "}
                  <strong className="font-mono text-surf-300">
                    {formatCents(amounts.theirRisk)}
                  </strong>
                </p>
                <p className="mt-1 text-white/80">
                  If you lose, you owe them{" "}
                  <strong className="font-mono text-red-300">
                    {formatCents(amounts.yourRisk)}
                  </strong>
                </p>
                <p className="mt-2 text-xs text-white/40">
                  Not even money — that&apos;s the price. You put up{" "}
                  {formatCents(amounts.yourRisk)}, they put up{" "}
                  {formatCents(amounts.theirRisk)}.
                </p>
              </>
            ) : (
              <>
                <p className="text-white/80">
                  Straight up — loser pays winner{" "}
                  <strong className="font-mono text-surf-300">
                    {formatCents(amounts.yourRisk)}
                  </strong>
                </p>
                <p className="mt-2 text-xs text-white/40">
                  Both sides put up the same amount.
                </p>
              </>
            )}
          </div>

          <div className="mt-5 flex gap-2">
            <button
              type="submit"
              disabled={pending || amounts === null}
              className="flex-1 rounded-md bg-surf-500 px-4 py-2 text-sm font-semibold text-deep-950 transition hover:bg-surf-300 disabled:opacity-60"
            >
              {pending ? "Posting..." : "Post it"}
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={pending}
              className="rounded-md border border-white/15 px-4 py-2 text-sm text-white/70 transition hover:border-white/40 hover:text-white disabled:opacity-40"
            >
              Cancel
            </button>
          </div>
        </form>

        <p className="mt-3 text-xs text-white/40">
          It goes on the board until somebody takes the other side.
        </p>
      </div>
    </div>
  );
}
