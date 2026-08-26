"use client";

import { useActionState } from "react";
import { submitLegAction, type ActionResult } from "@/lib/actions.ts";
import { inputClass, buttonClass } from "@/components/ui.tsx";
import type { ParlayLeg } from "@/lib/queries.ts";

export default function LegForm({
  parlayId,
  existing,
}: {
  parlayId: number;
  existing: ParlayLeg | null;
}) {
  const [state, formAction, pending] = useActionState<ActionResult, FormData>(
    submitLegAction,
    {},
  );

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="parlayId" value={parlayId} />

      <div className="grid gap-4 sm:grid-cols-[1fr_140px]">
        <div>
          <label
            htmlFor="description"
            className="mb-1.5 block text-sm text-white/70"
          >
            Your pick
          </label>
          <input
            id="description"
            name="description"
            required
            maxLength={200}
            defaultValue={existing?.description ?? ""}
            placeholder="Chiefs -3.5 vs Broncos"
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor="odds" className="mb-1.5 block text-sm text-white/70">
            Odds
          </label>
          <input
            id="odds"
            name="odds"
            required
            defaultValue={existing?.oddsAmerican ?? ""}
            placeholder="-110"
            inputMode="text"
            className={`${inputClass} font-mono`}
          />
        </div>
      </div>

      <p className="text-xs text-white/40">
        American odds, the way the book shows them: <code>-110</code>,{" "}
        <code>+250</code>. Anything between -100 and +100 isn&apos;t a real price.
      </p>

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
        {pending ? "Saving..." : existing ? "Update my leg" : "Add my leg"}
      </button>
    </form>
  );
}
