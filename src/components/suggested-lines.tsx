import { buildMarkets, type TeamLine } from "@/lib/lines.ts";
import { formatAmerican } from "@/lib/odds.ts";
import { postLineBetAction } from "@/lib/actions.ts";
import type { HeadToHead } from "@/lib/sleeper.ts";

/**
 * The generated market board.
 *
 * Every price is one click from being a real posted bet: choosing a side
 * fills in the same form somebody would otherwise type by hand.
 */
export default function SuggestedLines({
  season,
  week,
  matchups,
  projections,
  defaultStake = "5",
}: {
  season: number;
  week: number;
  matchups: HeadToHead[];
  projections: Map<number, number>;
  defaultStake?: string;
}) {
  const games = matchups.filter(
    (g) => projections.has(g.home.rosterId) && projections.has(g.away.rosterId),
  );

  if (games.length === 0) return null;

  return (
    <div className="space-y-5">
      {games.map((game) => {
        const home: TeamLine = {
          rosterId: game.home.rosterId,
          name: game.home.teamName,
          projected: projections.get(game.home.rosterId)!,
        };
        const away: TeamLine = {
          rosterId: game.away.rosterId,
          name: game.away.teamName,
          projected: projections.get(game.away.rosterId)!,
        };
        const markets = buildMarkets(home, away);

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
                projected {home.projected.toFixed(1)} – {away.projected.toFixed(1)}
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
                    const odds = market.odds?.[sideIndex];
                    const otherSide = market.sides[sideIndex === 0 ? 1 : 0];
                    return (
                      <form key={side} action={postLineBetAction}>
                        <input type="hidden" name="season" value={season} />
                        <input type="hidden" name="week" value={week} />
                        <input
                          type="hidden"
                          name="matchupId"
                          value={String(game.matchupId)}
                        />
                        <input
                          type="hidden"
                          name="title"
                          value={`${market.title}: ${home.name} vs ${away.name}`}
                        />
                        <input
                          type="hidden"
                          name="proposerSide"
                          value={odds ? `${side} (${formatAmerican(odds)})` : side}
                        />
                        <input
                          type="hidden"
                          name="takerSide"
                          value={
                            market.odds
                              ? `${otherSide} (${formatAmerican(
                                  market.odds[sideIndex === 0 ? 1 : 0],
                                )})`
                              : otherSide
                          }
                        />
                        <input type="hidden" name="stake" value={defaultStake} />
                        <button
                          type="submit"
                          className="flex w-full items-center justify-between gap-2 rounded border border-white/10 px-3 py-1.5 text-left text-sm text-white/80 transition hover:border-surf-500 hover:bg-surf-500/10 hover:text-white"
                        >
                          <span className="truncate">{side}</span>
                          {odds !== undefined && (
                            <span className="shrink-0 font-mono text-xs text-sunset-300">
                              {formatAmerican(odds)}
                            </span>
                          )}
                        </button>
                      </form>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
