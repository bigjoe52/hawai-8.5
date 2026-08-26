"use client";

import { formatAmerican } from "@/lib/odds.ts";
import type { Game } from "@/lib/nfl-board.ts";
import type { MarketOutcome } from "@/lib/polymarket.ts";

/**
 * The week's NFL slate: one row per game, with its moneyline, spread and
 * total side by side. Clicking any price fills in the leg form below.
 */
export default function NflBoard({
  games,
  week,
}: {
  games: Array<Omit<Game, "kickoff"> & { kickoff: string | null }>;
  week: number;
}) {
  const use = (description: string, odds: number) => {
    const desc = document.querySelector<HTMLInputElement>("#description");
    const oddsField = document.querySelector<HTMLInputElement>("#odds");
    if (!desc || !oddsField) return;
    desc.value = description;
    oddsField.value = String(odds);
    desc.dispatchEvent(new Event("input", { bubbles: true }));
    desc.scrollIntoView({ behavior: "smooth", block: "center" });
    desc.focus();
  };

  if (games.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-white/15 px-4 py-8 text-center text-sm text-white/40">
        No week {week} games on the board yet. Lines usually appear a few days
        out.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {games.map((game) => (
        <div
          key={game.key}
          className="rounded-lg border border-white/10 bg-white/[0.02] p-4"
        >
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="font-medium text-white">
              {game.away}{" "}
              <span className="text-white/30">{game.separator}</span>{" "}
              {game.home}
            </h3>
            {game.kickoff && (
              <span className="text-xs text-white/40">
                {new Date(game.kickoff).toLocaleString("en-US", {
                  weekday: "short",
                  hour: "numeric",
                  minute: "2-digit",
                  timeZone: "America/New_York",
                })}{" "}
                ET
              </span>
            )}
          </div>

          <div className="grid gap-2 sm:grid-cols-3">
            <MarketColumn
              title="Moneyline"
              outcomes={game.moneyline}
              game={`${game.away} ${game.separator} ${game.home}`}
              onPick={use}
            />
            <MarketColumn
              title="Spread"
              outcomes={game.spread}
              game={`${game.away} ${game.separator} ${game.home}`}
              onPick={use}
            />
            <MarketColumn
              title="Total"
              outcomes={game.total}
              game={`${game.away} ${game.separator} ${game.home}`}
              onPick={use}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function MarketColumn({
  title,
  outcomes,
  game,
  onPick,
}: {
  title: string;
  outcomes: MarketOutcome[] | null;
  game: string;
  onPick: (description: string, odds: number) => void;
}) {
  return (
    <div className="rounded-md border border-white/5 bg-deep-900/40 p-2">
      <p className="mb-1.5 text-xs uppercase tracking-wide text-white/40">
        {title}
      </p>
      {!outcomes ? (
        // Say so rather than leaving a blank the reader has to interpret.
        <p className="px-1 py-2 text-xs text-white/25">not offered</p>
      ) : (
        <div className="space-y-1">
          {outcomes.map((o) => (
            <button
              key={o.label}
              type="button"
              onClick={() => onPick(`${game} — ${o.label}`, o.odds)}
              className="flex w-full items-center justify-between gap-2 rounded border border-white/10 px-2 py-1.5 text-left text-sm text-white/80 transition hover:border-surf-500 hover:bg-surf-500/10 hover:text-white"
            >
              <span className="truncate">{o.label}</span>
              <span className="shrink-0 font-mono text-xs text-sunset-300">
                {formatAmerican(o.odds)}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
