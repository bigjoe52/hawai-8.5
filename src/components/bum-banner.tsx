import type { Placer } from "@/lib/placer.ts";

/**
 * BUM OF THE WEEK.
 *
 * Whoever came last has to place the ticket, and the site is not subtle about
 * it. Loud on purpose -- that is the entire point of the feature.
 */
export default function BumBanner({
  placer,
  currentUserId,
}: {
  placer: Placer;
  currentUserId: number;
}) {
  // Nobody to shame yet.
  if (!placer.displayName) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/[0.02] px-5 py-4">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-white/40">
          Bum of the week
        </p>
        <p className="mt-1 text-lg text-white/60">Not decided yet.</p>
        <p className="mt-0.5 text-sm text-white/40">{placer.reason}</p>
      </div>
    );
  }

  const itsYou = placer.userId === currentUserId;

  return (
    <div
      className={`relative overflow-hidden rounded-xl border-2 px-5 py-5 ${
        itsYou
          ? "border-red-500 bg-gradient-to-r from-red-600/30 via-sunset-600/25 to-transparent"
          : "border-sunset-500 bg-gradient-to-r from-sunset-500/25 via-sunset-500/10 to-transparent"
      }`}
    >
      <p
        className={`text-xs font-black uppercase tracking-[0.25em] ${
          itsYou ? "text-red-300" : "text-sunset-300"
        }`}
      >
        🗑️ Bum of the week
      </p>

      <p className="mt-2 text-3xl font-black leading-tight text-white sm:text-4xl">
        {itsYou ? (
          <>
            <span className={itsYou ? "text-red-300" : "text-sunset-300"}>You</span>{" "}
            place the bet.
          </>
        ) : (
          <>
            <span className="text-sunset-200">{placer.displayName}</span> places
            the bet.
          </>
        )}
      </p>

      {placer.points !== null ? (
        <p className="mt-1.5 text-base font-semibold text-white/80 sm:text-lg">
          Score of{" "}
          <span className="font-mono text-white">{placer.points.toFixed(1)}</span>{" "}
          points last week.
          {placer.fromWeek !== null && (
            <span className="ml-2 text-sm font-normal text-white/40">
              (week {placer.fromWeek}, dead last)
            </span>
          )}
        </p>
      ) : placer.isFirstWeek ? (
        <p className="mt-1.5 text-base text-white/60">
          Week 1 — no scores to hide behind yet.
        </p>
      ) : (
        // Not week 1: we know who it is but not the score, which means Sleeper
        // was unreachable. Say that, rather than claiming it is week 1.
        <p className="mt-1.5 text-base text-white/60">
          Last week&apos;s score unavailable right now.
        </p>
      )}
    </div>
  );
}
