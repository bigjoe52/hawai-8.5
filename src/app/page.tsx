import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth.ts";
import { configProblems } from "@/lib/config.ts";
import SetupNeeded from "@/components/setup-needed.tsx";
import {
  getOrCreateParlay,
  listMembers,
  listSideBets,
  listSettledBets,
} from "@/lib/queries.ts";
import { currentWeek } from "@/lib/week.ts";
import { resolveParlay, formatCents, formatAmerican } from "@/lib/odds.ts";
import { pairwiseDebts } from "@/lib/ledger.ts";
import { Nav, Page, Card, Badge, Empty, buttonClass } from "@/components/ui.tsx";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  // Show what needs configuring rather than a bare 500 page.
  const problems = configProblems();
  if (problems.length > 0) return <SetupNeeded problems={problems} />;

  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const ctx = await currentWeek();
  const [parlay, members, bets, settled] = await Promise.all([
    getOrCreateParlay(ctx.season, ctx.week),
    listMembers(),
    listSideBets(ctx.season, ctx.week),
    listSettledBets(),
  ]);

  const myLeg = parlay.legs.find((l) => l.userId === user.id);
  const outcome = resolveParlay(parlay.legs);
  const openBets = bets.filter(
    (b) => b.status === "open" && b.proposerId !== user.id,
  );
  const myTab = pairwiseDebts(settled).filter(
    (d) => d.fromUserId === user.id || d.toUserId === user.id,
  );
  const owed = myTab.reduce(
    (sum, d) => sum + (d.toUserId === user.id ? d.cents : -d.cents),
    0,
  );

  return (
    <>
      <Nav user={user} />
      <Page>
        <div>
          <h1 className="text-2xl font-bold">
            Aloha, {user.displayName.split(" ")[0]} 🤙
          </h1>
          <p className="mt-1 text-sm text-white/50">
            Week {ctx.week} of the {ctx.season} season
          </p>
        </div>

        {/* The one thing you have to do this week. */}
        {parlay.status === "open" && !myLeg && (
          <Card accent title="You haven't put your leg in">
            <p className="text-sm text-white/70">
              The week&apos;s parlay is waiting on you and{" "}
              {members.length - parlay.legs.length - 1} other
              {members.length - parlay.legs.length - 1 === 1 ? "" : "s"}.
            </p>
            <Link href="/parlay" className={`${buttonClass} mt-4 inline-block`}>
              Add my leg
            </Link>
          </Card>
        )}

        <div className="grid gap-6 md:grid-cols-2">
          <Card title={`Week ${ctx.week} parlay`}>
            <div className="mb-3 flex items-center gap-3">
              <Badge status={outcome === "pending" ? parlay.status : outcome} />
              <span className="text-sm text-white/50">
                {parlay.legs.length} / {members.length} legs
              </span>
            </div>

            {parlay.legs.length === 0 ? (
              <Empty>Nothing on the board yet.</Empty>
            ) : (
              <ul className="space-y-1.5">
                {parlay.legs.slice(0, 5).map((leg) => (
                  <li
                    key={leg.id}
                    className="flex items-center justify-between gap-3 text-sm"
                  >
                    <span
                      className={`truncate ${
                        leg.status === "loss"
                          ? "text-white/30 line-through"
                          : "text-white/80"
                      }`}
                    >
                      {leg.description}
                    </span>
                    <span className="shrink-0 font-mono text-xs text-sunset-300">
                      {formatAmerican(leg.oddsAmerican)}
                    </span>
                  </li>
                ))}
                {parlay.legs.length > 5 && (
                  <li className="text-xs text-white/40">
                    + {parlay.legs.length - 5} more
                  </li>
                )}
              </ul>
            )}

            <Link
              href="/parlay"
              className="mt-4 inline-block text-sm text-surf-300 hover:text-surf-100"
            >
              See the full ticket →
            </Link>
          </Card>

          <Card title="Your tab">
            <p
              className={`font-mono text-3xl ${
                owed > 0
                  ? "text-surf-300"
                  : owed < 0
                    ? "text-red-300"
                    : "text-white/40"
              }`}
            >
              {owed > 0 ? "+" : ""}
              {formatCents(owed)}
            </p>
            <p className="mt-1 text-sm text-white/50">
              {owed > 0
                ? "Collect it."
                : owed < 0
                  ? "Pay up."
                  : "All square."}
            </p>
            <Link
              href="/ledger"
              className="mt-4 inline-block text-sm text-surf-300 hover:text-surf-100"
            >
              Full ledger →
            </Link>
          </Card>
        </div>

        <Card
          title="Open side bets"
          subtitle="Posted by other people, nobody's taken them."
        >
          {openBets.length === 0 ? (
            <Empty>Nothing to take right now.</Empty>
          ) : (
            <ul className="space-y-2">
              {openBets.slice(0, 5).map((bet) => (
                <li
                  key={bet.id}
                  className="flex flex-wrap items-center justify-between gap-2 border-b border-white/5 py-2 text-sm last:border-0"
                >
                  <span className="text-white/80">
                    {bet.title}{" "}
                    <span className="text-white/40">· {bet.proposerName}</span>
                  </span>
                  <span className="font-mono text-sunset-300">
                    {formatCents(bet.stakeCents)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <Link
            href="/side-bets"
            className="mt-4 inline-block text-sm text-surf-300 hover:text-surf-100"
          >
            All side bets →
          </Link>
        </Card>
      </Page>
    </>
  );
}
