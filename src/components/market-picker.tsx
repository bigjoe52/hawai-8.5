"use client";

import { useState } from "react";
import { formatAmerican } from "@/lib/odds.ts";
import type { PolyMarket } from "@/lib/polymarket.ts";

/**
 * Pick a parlay leg from live Polymarket prices instead of typing one.
 *
 * Choosing a side fills the leg form below with the wording and the real
 * price, which the person can still edit before submitting.
 */
export default function MarketPicker({ markets }: { markets: PolyMarket[] }) {
  const [query, setQuery] = useState("");

  const visible = markets
    .filter((m) => m.question.toLowerCase().includes(query.toLowerCase()))
    .slice(0, 25);

  const use = (description: string, odds: number) => {
    // The leg form lives on the same page, so fill it in directly.
    const desc = document.querySelector<HTMLInputElement>("#description");
    const oddsField = document.querySelector<HTMLInputElement>("#odds");
    if (!desc || !oddsField) return;
    desc.value = description;
    oddsField.value = String(odds);
    desc.dispatchEvent(new Event("input", { bubbles: true }));
    desc.scrollIntoView({ behavior: "smooth", block: "center" });
    desc.focus();
  };

  return (
    <div>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Filter markets — team name, player, anything"
        className="mb-3 w-full rounded-md border border-white/15 bg-deep-900/70 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-surf-500 focus:outline-none"
      />

      {visible.length === 0 ? (
        <p className="py-6 text-center text-sm text-white/40">
          Nothing matches &ldquo;{query}&rdquo;.
        </p>
      ) : (
        <ul className="max-h-96 space-y-2 overflow-y-auto pr-1">
          {visible.map((m) => (
            <li
              key={m.id}
              className="rounded-lg border border-white/10 bg-white/[0.02] p-3"
            >
              <p className="text-sm text-white/85">{m.question}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {m.outcomes.map((o) => (
                  <button
                    key={o.label}
                    type="button"
                    onClick={() => use(`${m.question} — ${o.label}`, o.odds)}
                    className="flex items-center gap-2 rounded border border-white/10 px-2.5 py-1 text-sm text-white/80 transition hover:border-surf-500 hover:bg-surf-500/10 hover:text-white"
                  >
                    <span>{o.label}</span>
                    <span className="font-mono text-xs text-sunset-300">
                      {formatAmerican(o.odds)}
                    </span>
                  </button>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-3 text-xs text-white/40">
        Live prices from Polymarket, converted to American odds. Picking one
        fills the form below — you can still edit it.
      </p>
    </div>
  );
}
