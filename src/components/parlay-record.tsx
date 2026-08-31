import Link from "next/link";
import type { ParlayRecord } from "@/lib/queries.ts";
import {
  combinedDecimalOdds,
  decimalToAmerican,
  formatCents,
  formatAmerican,
} from "@/lib/odds.ts";
import { Badge, Empty } from "@/components/ui.tsx";

/**
 * The parlay's season record: one row per week, plus what it has cost.
 *
 * The weekly ticket is a group bet against a sportsbook rather than between
 * members, so it is kept apart from the who-owes-who ledger and totalled on
 * its own.
 */
export default function ParlayRecordTable({ rows }: { rows: ParlayRecord[] }) {
  if (rows.length === 0) {
    return <Empty>No parlays yet. The first one starts in week 1.</Empty>;
  }

  const graded = rows.filter((r) => r.status === "won" || r.status === "lost");
  const staked = graded.reduce((sum, r) => sum + r.stakeCents, 0);
  const returned = graded.reduce(
    (sum, r) => sum + (r.status === "won" ? payoutOf(r) : 0),
    0,
  );
  const net = returned - staked;
  const wins = graded.filter((r) => r.status === "won").length;

  return (
    <>
      {graded.length > 0 && (
        <dl className="mb-5 grid gap-4 sm:grid-cols-4">
          <Stat label="Record" value={`${wins}–${graded.length - wins}`} />
          <Stat label="Staked" value={formatCents(staked)} />
          <Stat label="Returned" value={formatCents(returned)} />
          <Stat
            label="Net"
            value={`${net > 0 ? "+" : ""}${formatCents(net)}`}
            tone={net > 0 ? "good" : net < 0 ? "bad" : "flat"}
          />
        </dl>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/10 text-left text-xs uppercase tracking-wide text-white/40">
              <th className="py-2 pr-4 font-medium">Week</th>
              <th className="py-2 pr-4 font-medium">Result</th>
              <th className="py-2 pr-4 text-right font-medium">Legs</th>
              <th className="py-2 pr-4 text-right font-medium">Odds</th>
              <th className="py-2 pr-4 text-right font-medium">Stake</th>
              <th className="py-2 pr-4 text-right font-medium">Returned</th>
              <th className="py-2 font-medium">Notes</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const payout = r.status === "won" ? payoutOf(r) : 0;
              return (
                <tr
                  key={`${r.season}-${r.week}`}
                  className="border-b border-white/5 last:border-0"
                >
                  <td className="py-2.5 pr-4">
                    <Link
                      href={`/parlay?week=${r.week}`}
                      className="text-white/80 hover:text-surf-300"
                    >
                      {r.week}
                    </Link>
                  </td>
                  <td className="py-2.5 pr-4">
                    <Badge status={r.status} />
                  </td>
                  <td className="py-2.5 pr-4 text-right font-mono text-white/60">
                    {r.wonLegs}/{r.legCount}
                  </td>
                  <td className="py-2.5 pr-4 text-right font-mono text-sunset-300">
                    {formatCombined(r)}
                  </td>
                  <td className="py-2.5 pr-4 text-right font-mono text-white/60">
                    {formatCents(r.stakeCents)}
                  </td>
                  <td
                    className={`py-2.5 pr-4 text-right font-mono ${
                      r.status === "won"
                        ? "text-surf-300"
                        : r.status === "lost"
                          ? "text-red-300"
                          : "text-white/30"
                    }`}
                  >
                    {r.status === "won"
                      ? formatCents(payout)
                      : r.status === "lost"
                        ? formatCents(0)
                        : "—"}
                  </td>
                  <td className="py-2.5 text-white/50">
                    {r.bustedBy.length > 0 ? (
                      <span className="text-red-300/80">
                        busted by {r.bustedBy.join(", ")}
                      </span>
                    ) : r.pendingLegs > 0 && r.legCount > 0 ? (
                      `${r.pendingLegs} leg${r.pendingLegs === 1 ? "" : "s"} still live`
                    ) : r.legCount === 0 ? (
                      "no legs"
                    ) : (
                      ""
                    )}
                    {r.placerName && (
                      <span className="ml-2 text-xs text-white/30">
                        placed by {r.placerName}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

/**
 * What a winning ticket returned, stake included.
 *
 * The legs are passed through with their real statuses, so a pushed leg drops
 * out of the price instead of multiplying into it. Rebuilding them all as
 * wins -- which this used to do -- overstated both the odds and the payout on
 * any week somebody pushed.
 */
function payoutOf(r: ParlayRecord): number {
  if (r.legs.length === 0) return 0;
  return Math.round(r.stakeCents * combinedDecimalOdds(r.legs));
}

/** The ticket's combined price, or a dash when there is no price to show. */
function formatCombined(r: ParlayRecord): string {
  if (r.legs.length === 0) return "—";
  const decimal = combinedDecimalOdds(r.legs);
  // An all-push ticket multiplies out to exactly 1, which is not a price.
  if (decimal <= 1) return "—";
  return formatAmerican(decimalToAmerican(decimal));
}

function Stat({
  label,
  value,
  tone = "flat",
}: {
  label: string;
  value: string;
  tone?: "good" | "bad" | "flat";
}) {
  const colour =
    tone === "good" ? "text-surf-300" : tone === "bad" ? "text-red-300" : "text-white";
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-white/40">{label}</dt>
      <dd className={`mt-1 font-mono text-lg ${colour}`}>{value}</dd>
    </div>
  );
}
