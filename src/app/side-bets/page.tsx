import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth.ts";
import { configProblems } from "@/lib/config.ts";
import SetupNeeded from "@/components/setup-needed.tsx";
import { listSideBets } from "@/lib/queries.ts";
import { currentWeek } from "@/lib/week.ts";
import { getWeekMatchups, getWeekProjections } from "@/lib/sleeper.ts";
import { formatCents } from "@/lib/odds.ts";
import { takeSideBetAction, cancelSideBetAction } from "@/lib/actions.ts";
import {
  Nav,
  Page,
  Card,
  Badge,
  Empty,
  SleeperWarning,
  buttonClass,
  ghostButtonClass,
} from "@/components/ui.tsx";
import SideBetForm from "./side-bet-form.tsx";
import SuggestedLines from "@/components/suggested-lines.tsx";

export const dynamic = "force-dynamic";

export default async function SideBetsPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  // Show what needs configuring rather than a bare 500 page.
  const problems = configProblems();
  if (problems.length > 0) return <SetupNeeded problems={problems} />;

  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const params = await searchParams;
  const ctx = await currentWeek();
  const week = Number(params.week) || ctx.week;
  const season = ctx.season;

  const leagueId = process.env.SLEEPER_LEAGUE_ID;
  const noLeague = {
    ok: false as const,
    error: "SLEEPER_LEAGUE_ID isn't set in the environment.",
  };
  const [bets, matchups, projections] = await Promise.all([
    listSideBets(season, week),
    leagueId ? getWeekMatchups(leagueId, week) : Promise.resolve(noLeague),
    leagueId ? getWeekProjections(leagueId, season, week) : Promise.resolve(noLeague),
  ]);

  const open = bets.filter((b) => b.status === "open");
  const matched = bets.filter((b) => b.status === "matched");
  const done = bets.filter((b) => b.status === "settled" || b.status === "void");

  return (
    <>
      <Nav user={user} />
      <Page>
        <div>
          <h1 className="text-2xl font-bold">Side Bets · Week {week}</h1>
          <p className="mt-1 text-sm text-white/50">
            Head-to-head on the fantasy matchups. Post a price, someone takes
            the other side.
          </p>
        </div>

        {!matchups.ok && <SleeperWarning error={matchups.error} />}

        {matchups.ok && matchups.data.length > 0 && (
          <Card
            title="This week's fantasy matchups"
            subtitle="Live from Sleeper. Bet on any of these."
          >
            <ul className="grid gap-2 sm:grid-cols-2">
              {matchups.data.map((g) => (
                <li
                  key={g.matchupId}
                  className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2 text-sm"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-white/80">{g.home.teamName}</span>
                    <span className="shrink-0 font-mono text-surf-300">
                      {g.home.points.toFixed(2)}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <span className="truncate text-white/80">{g.away.teamName}</span>
                    <span className="shrink-0 font-mono text-surf-300">
                      {g.away.points.toFixed(2)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        )}

        {matchups.ok && projections.ok && (
          <Card
            title="The board"
            subtitle="Lines built from Sleeper's weekly projections. Click a side to post it as a bet."
          >
            <SuggestedLines
              season={season}
              week={week}
              matchups={matchups.data}
              projections={projections.data}
            />
            <p className="mt-4 text-xs text-white/40">
              Clicking a side puts a $5 bet on the board for someone else to
              take. The price is recorded in the wording; side bets settle head
              to head at the stake shown.
            </p>
          </Card>
        )}

        {matchups.ok && !projections.ok && (
          <div className="rounded-lg border border-white/10 bg-white/[0.02] px-4 py-3 text-sm text-white/50">
            <strong className="text-white/70">No generated lines this week.</strong>{" "}
            {projections.error}
          </div>
        )}

        <Card title="Post your own" subtitle="Be specific. Vague bets start fights.">
          <SideBetForm
            season={season}
            week={week}
            matchups={matchups.ok ? matchups.data : []}
          />
        </Card>

        <Card
          title="Up for grabs"
          subtitle="Nobody has taken these yet."
        >
          {open.length === 0 ? (
            <Empty>No open bets. Post one above.</Empty>
          ) : (
            <ul className="space-y-3">
              {open.map((bet) => (
                <li
                  key={bet.id}
                  className="rounded-lg border border-white/10 bg-white/[0.02] p-4"
                >
                  <BetHeader
                    title={bet.title}
                    stake={bet.stakeCents}
                    status={bet.status}
                  />
                  {bet.details && (
                    <p className="mt-2 text-sm text-white/60">{bet.details}</p>
                  )}
                  <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                    <SideBox
                      label={`${bet.proposerName} has`}
                      value={bet.proposerSide}
                    />
                    <SideBox label="You'd have" value={bet.takerSide} accent />
                  </div>

                  <div className="mt-4 flex gap-2">
                    {bet.proposerId === user.id ? (
                      <form action={cancelSideBetAction}>
                        <input type="hidden" name="betId" value={bet.id} />
                        <button type="submit" className={ghostButtonClass}>
                          Pull it back
                        </button>
                      </form>
                    ) : (
                      <form action={takeSideBetAction}>
                        <input type="hidden" name="betId" value={bet.id} />
                        <button type="submit" className={buttonClass}>
                          Take the other side · {formatCents(bet.stakeCents)}
                        </button>
                      </form>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Locked in" subtitle="Matched, waiting on the result.">
          {matched.length === 0 ? (
            <Empty>Nothing matched this week yet.</Empty>
          ) : (
            <ul className="space-y-3">
              {matched.map((bet) => (
                <li
                  key={bet.id}
                  className="rounded-lg border border-white/10 bg-white/[0.02] p-4"
                >
                  <BetHeader
                    title={bet.title}
                    stake={bet.stakeCents}
                    status={bet.status}
                  />
                  <p className="mt-2 text-sm text-white/60">
                    <span className="text-white/80">{bet.proposerName}</span> (
                    {bet.proposerSide}) vs{" "}
                    <span className="text-white/80">{bet.takerName}</span> (
                    {bet.takerSide})
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {done.length > 0 && (
          <Card title="Finished">
            <ul className="space-y-2">
              {done.map((bet) => {
                const winnerName =
                  bet.winner === "proposer"
                    ? bet.proposerName
                    : bet.winner === "taker"
                      ? bet.takerName
                      : null;
                return (
                  <li
                    key={bet.id}
                    className="flex flex-wrap items-center justify-between gap-2 border-b border-white/5 py-2 text-sm last:border-0"
                  >
                    <span className="text-white/70">{bet.title}</span>
                    <span className="flex items-center gap-3">
                      <span className="text-white/50">
                        {winnerName ? (
                          <>
                            <span className="text-surf-300">{winnerName}</span>{" "}
                            won {formatCents(bet.stakeCents)}
                          </>
                        ) : (
                          "push — no money moved"
                        )}
                      </span>
                      <Badge status={bet.status} />
                    </span>
                  </li>
                );
              })}
            </ul>
          </Card>
        )}
      </Page>
    </>
  );
}

function BetHeader({
  title,
  stake,
  status,
}: {
  title: string;
  stake: number;
  status: string;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="font-medium text-white">{title}</h3>
      <span className="flex items-center gap-2">
        <span className="font-mono text-sm text-sunset-300">
          {formatCents(stake)}
        </span>
        <Badge status={status} />
      </span>
    </div>
  );
}

function SideBox({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div
      className={`rounded-md border px-3 py-2 ${
        accent
          ? "border-surf-500/30 bg-surf-500/5"
          : "border-white/10 bg-white/[0.02]"
      }`}
    >
      <p className="text-xs uppercase tracking-wide text-white/40">{label}</p>
      <p className="mt-0.5 text-white/90">{value}</p>
    </div>
  );
}
