import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth.ts";
import { configProblems } from "@/lib/config.ts";
import SetupNeeded from "@/components/setup-needed.tsx";
import {
  listGradedBets,
  listUnpaidBets,
  listMembers,
  listParlayHistory,
  listLegRecords,
} from "@/lib/queries.ts";
import ParlayRecordTable from "@/components/parlay-record.tsx";
import LegStandings from "@/components/leg-standings.tsx";
import { standings, pairwiseDebts, netByUser, assertBalanced } from "@/lib/ledger.ts";
import { formatCents } from "@/lib/odds.ts";
import { Nav, Page, Card, Empty } from "@/components/ui.tsx";

export const dynamic = "force-dynamic";

export default async function LedgerPage() {
  // Show what needs configuring rather than a bare 500 page.
  const problems = configProblems();
  if (problems.length > 0) return <SetupNeeded problems={problems} />;

  const user = await getCurrentUser();
  if (!user) redirect("/login");

  // Standings run on everything graded -- a win is a win once the games end.
  // "Who owes who" runs only on what is still unpaid.
  const [graded, unpaid, members, parlays, legRecords] = await Promise.all([
    listGradedBets(),
    listUnpaidBets(),
    listMembers(),
    listParlayHistory(),
    listLegRecords(),
  ]);
  const nameById = new Map(members.map((m) => [m.id, m.displayName]));
  const name = (id: number) => nameById.get(id) ?? `Player ${id}`;

  const rows = standings(graded);
  const debts = pairwiseDebts(unpaid);

  // If this ever throws, the ledger is wrong and nobody should trust it.
  // Better a loud error than quietly telling someone they owe the wrong amount.
  assertBalanced(netByUser(graded));

  const mine = debts.filter(
    (d) => d.fromUserId === user.id || d.toUserId === user.id,
  );

  return (
    <>
      <Nav user={user} />
      <Page>
        <div>
          <h1 className="text-2xl font-bold">The Ledger</h1>
          <p className="mt-1 text-sm text-white/50">
            Outstanding tabs only — once a winner marks a bet paid it drops off
            here but stays in the standings. Settle up however you normally do.
          </p>
        </div>

        <Card title="Your tab">
          {mine.length === 0 ? (
            <Empty>You&apos;re square with everyone.</Empty>
          ) : (
            <ul className="space-y-2">
              {mine.map((d, i) => {
                const owing = d.fromUserId === user.id;
                return (
                  <li
                    key={i}
                    className={`flex items-center justify-between rounded-lg border px-4 py-3 ${
                      owing
                        ? "border-red-500/30 bg-red-500/5"
                        : "border-surf-500/30 bg-surf-500/5"
                    }`}
                  >
                    <span className="text-sm text-white/80">
                      {owing ? (
                        <>
                          You owe{" "}
                          <strong className="text-white">
                            {name(d.toUserId)}
                          </strong>
                        </>
                      ) : (
                        <>
                          <strong className="text-white">
                            {name(d.fromUserId)}
                          </strong>{" "}
                          owes you
                        </>
                      )}
                    </span>
                    <span
                      className={`font-mono text-lg ${
                        owing ? "text-red-300" : "text-surf-300"
                      }`}
                    >
                      {formatCents(d.cents)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card
          title="Parlay record"
          subtitle="The weekly ticket is a group bet against the book, so it is counted separately from what members owe each other."
        >
          <ParlayRecordTable rows={parlays} />
        </Card>

        <Card
          title="Leg records"
          subtitle="How everyone's parlay legs have gone this season. Nobody is hitting a ten-leg ticket — this is the part worth arguing about."
        >
          <LegStandings records={legRecords} currentUserId={user.id} />
        </Card>

        <Card
          title="Side bet standings"
          subtitle="Net across every graded side bet, paid or not."
        >
          {rows.length === 0 ? (
            <Empty>Nothing settled yet.</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10 text-left text-xs uppercase tracking-wide text-white/40">
                    <th className="py-2 pr-4 font-medium">#</th>
                    <th className="py-2 pr-4 font-medium">Player</th>
                    <th className="py-2 pr-4 text-right font-medium">W</th>
                    <th className="py-2 pr-4 text-right font-medium">L</th>
                    <th className="py-2 pr-4 text-right font-medium">P</th>
                    <th className="py-2 text-right font-medium">Net</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr
                      key={r.userId}
                      className={`border-b border-white/5 last:border-0 ${
                        r.userId === user.id ? "bg-white/[0.03]" : ""
                      }`}
                    >
                      <td className="py-2.5 pr-4 font-mono text-white/30">
                        {i + 1}
                      </td>
                      <td className="py-2.5 pr-4 text-white/90">
                        {name(r.userId)}
                        {r.userId === user.id && (
                          <span className="text-surf-300"> · you</span>
                        )}
                      </td>
                      <td className="py-2.5 pr-4 text-right font-mono text-white/60">
                        {r.wins}
                      </td>
                      <td className="py-2.5 pr-4 text-right font-mono text-white/60">
                        {r.losses}
                      </td>
                      <td className="py-2.5 pr-4 text-right font-mono text-white/40">
                        {r.pushes}
                      </td>
                      <td
                        className={`py-2.5 text-right font-mono ${
                          r.netCents > 0
                            ? "text-surf-300"
                            : r.netCents < 0
                              ? "text-red-300"
                              : "text-white/40"
                        }`}
                      >
                        {r.netCents > 0 ? "+" : ""}
                        {formatCents(r.netCents)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card
          title="Everyone's tabs"
          subtitle="Already netted out — one number per pair."
        >
          {debts.length === 0 ? (
            <Empty>Nobody owes anybody anything.</Empty>
          ) : (
            <ul className="space-y-1.5">
              {debts.map((d, i) => (
                <li
                  key={i}
                  className="flex items-center justify-between border-b border-white/5 py-2 text-sm last:border-0"
                >
                  <span className="text-white/70">
                    <strong className="text-white/90">{name(d.fromUserId)}</strong>{" "}
                    → {name(d.toUserId)}
                  </span>
                  <span className="font-mono text-sunset-300">
                    {formatCents(d.cents)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </Page>
    </>
  );
}
