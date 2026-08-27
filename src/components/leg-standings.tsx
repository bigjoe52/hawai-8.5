import type { LegRecord } from "@/lib/queries.ts";
import {
  rankLegRecords,
  formatRecord,
  formatHitRate,
} from "@/lib/leg-standings.ts";
import { Empty } from "@/components/ui.tsx";

/**
 * Everyone's season record on their parlay legs.
 *
 * Nobody expects to hit a ten-leg parlay, so this is the part people actually
 * follow: who keeps picking, and who keeps being the reason it died.
 */
export default function LegStandings({
  records,
  currentUserId,
}: {
  records: LegRecord[];
  currentUserId: number;
}) {
  const ranked = rankLegRecords(records);
  const anyLegs = ranked.some((r) => r.decided > 0 || r.pending > 0);

  if (!anyLegs) {
    return <Empty>No legs graded yet. Records start after week 1.</Empty>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-white/10 text-left text-xs uppercase tracking-wide text-white/40">
            <th className="py-2 pr-4 font-medium">#</th>
            <th className="py-2 pr-4 font-medium">Player</th>
            <th className="py-2 pr-4 text-right font-medium">Record</th>
            <th className="py-2 pr-4 text-right font-medium">Hit rate</th>
            <th className="py-2 pr-4 text-right font-medium">Solo busts</th>
            <th className="py-2 text-right font-medium">Live</th>
          </tr>
        </thead>
        <tbody>
          {ranked.map((r, i) => (
            <tr
              key={r.userId}
              className={`border-b border-white/5 last:border-0 ${
                r.isWorst
                  ? "bg-red-500/[0.07]"
                  : r.userId === currentUserId
                    ? "bg-white/[0.03]"
                    : ""
              }`}
            >
              <td className="py-2.5 pr-4 font-mono text-white/30">
                {r.hitRate === null ? "—" : i + 1}
              </td>
              <td className="py-2.5 pr-4 text-white/90">
                {r.displayName}
                {r.userId === currentUserId && (
                  <span className="text-surf-300"> · you</span>
                )}
                {r.isWorst && (
                  <span className="ml-2 text-xs font-semibold text-red-300">
                    🗑️ worst in the league
                  </span>
                )}
              </td>
              <td className="py-2.5 pr-4 text-right font-mono text-white/70">
                {formatRecord(r)}
              </td>
              <td
                className={`py-2.5 pr-4 text-right font-mono ${
                  r.hitRate === null
                    ? "text-white/30"
                    : r.hitRate >= 0.5
                      ? "text-surf-300"
                      : "text-red-300"
                }`}
              >
                {formatHitRate(r.hitRate)}
              </td>
              <td
                className={`py-2.5 pr-4 text-right font-mono ${
                  r.soloBusts > 0 ? "text-red-300" : "text-white/30"
                }`}
              >
                {r.soloBusts || "—"}
              </td>
              <td className="py-2.5 text-right font-mono text-white/40">
                {r.pending || "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="mt-3 text-xs text-white/40">
        <strong className="text-white/60">Solo busts</strong> are weeks your leg
        was the only one that lost — the ticket was alive until you, personally,
        ended it.
      </p>
    </div>
  );
}
