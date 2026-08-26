"use client";

import { useActionState } from "react";
import { postSideBetAction, type ActionResult } from "@/lib/actions.ts";
import { inputClass, buttonClass } from "@/components/ui.tsx";
import type { HeadToHead } from "@/lib/sleeper.ts";

export default function SideBetForm({
  season,
  week,
  matchups,
}: {
  season: number;
  week: number;
  matchups: HeadToHead[];
}) {
  const [state, formAction, pending] = useActionState<ActionResult, FormData>(
    postSideBetAction,
    {},
  );

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="season" value={season} />
      <input type="hidden" name="week" value={week} />

      <div className="grid gap-4 sm:grid-cols-[1fr_120px]">
        <div>
          <label htmlFor="title" className="mb-1.5 block text-sm text-white/70">
            What&apos;s the bet?
          </label>
          <input
            id="title"
            name="title"
            required
            maxLength={140}
            placeholder="Big Kahunas over 118.5 points"
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="stake" className="mb-1.5 block text-sm text-white/70">
            Stake
          </label>
          <input
            id="stake"
            name="stake"
            required
            placeholder="20"
            inputMode="decimal"
            className={`${inputClass} font-mono`}
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label
            htmlFor="proposerSide"
            className="mb-1.5 block text-sm text-white/70"
          >
            You&apos;re taking
          </label>
          <input
            id="proposerSide"
            name="proposerSide"
            required
            placeholder="the over"
            className={inputClass}
          />
        </div>
        <div>
          <label
            htmlFor="takerSide"
            className="mb-1.5 block text-sm text-white/70"
          >
            They&apos;d be taking
          </label>
          <input
            id="takerSide"
            name="takerSide"
            required
            placeholder="the under"
            className={inputClass}
          />
        </div>
      </div>

      {matchups.length > 0 && (
        <div>
          <label
            htmlFor="matchupId"
            className="mb-1.5 block text-sm text-white/70"
          >
            Which matchup? <span className="text-white/30">(optional)</span>
          </label>
          <select id="matchupId" name="matchupId" className={inputClass}>
            <option value="">Not tied to one game</option>
            {matchups.map((g) => (
              <option key={g.matchupId} value={String(g.matchupId)}>
                {g.home.teamName} vs {g.away.teamName}
              </option>
            ))}
          </select>
        </div>
      )}

      <div>
        <label htmlFor="details" className="mb-1.5 block text-sm text-white/70">
          Fine print <span className="text-white/30">(optional)</span>
        </label>
        <textarea
          id="details"
          name="details"
          rows={2}
          placeholder="Final scores only, no stat corrections."
          className={inputClass}
        />
      </div>

      {state.error && (
        <p className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {state.error}
        </p>
      )}
      {state.ok && (
        <p className="rounded-md border border-surf-500/30 bg-surf-500/10 px-3 py-2 text-sm text-surf-300">
          {state.ok}
        </p>
      )}

      <button type="submit" disabled={pending} className={buttonClass}>
        {pending ? "Posting..." : "Post it"}
      </button>
    </form>
  );
}
