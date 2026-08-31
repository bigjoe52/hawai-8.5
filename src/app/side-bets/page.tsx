import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth.ts";
import { configProblems } from "@/lib/config.ts";
import SetupNeeded from "@/components/setup-needed.tsx";
import { listSideBets, type SideBet } from "@/lib/queries.ts";
import { currentWeek, normaliseWeek } from "@/lib/week.ts";
import { getWeekMatchups, getWeekProjections } from "@/lib/sleeper.ts";
import { autoSettleFinishedWeeks } from "@/lib/settle.ts";
import { formatCents } from "@/lib/odds.ts";
import {
  takeSideBetAction,
  cancelSideBetAction,
  markPaidAction,
  markUnpaidAction,
  settleSideBetAction,
  reopenSideBetAction,
} from "@/lib/actions.ts";
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

const TABS = [
  { key: "take", label: "Bets I can take" },
  { key: "mine", label: "My posted bets" },
  { key: "live", label: "Matched" },
  { key: "done", label: "Finished" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export default async function SideBetsPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string; tab?: string }>;
}) {
  const problems = configProblems();
  if (problems.length > 0) return <SetupNeeded problems={problems} />;

  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const params = await searchParams;
  const ctx = currentWeek();
  const week = normaliseWeek(params.week, ctx.week);
  const season = ctx.season;
  const tab: TabKey =
    TABS.some((t) => t.key === params.tab) ? (params.tab as TabKey) : "take";

  // Grade anything from a finished week before reading, so results turn up on
  // their own rather than waiting for the commissioner.
  await autoSettleFinishedWeeks();

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

  const mine = bets.filter(
    (b) => b.proposerId === user.id || b.takerId === user.id,
  );
  const buckets: Record<TabKey, SideBet[]> = {
    take: bets.filter((b) => b.status === "open" && b.proposerId !== user.id),
    mine: mine.filter((b) => b.status === "open" || b.status === "matched"),
    live: bets.filter((b) => b.status === "matched"),
    done: bets.filter(
      (b) => b.status === "unpaid" || b.status === "paid" || b.status === "void",
    ),
  };
  const unpaidMine = mine.filter((b) => b.status === "unpaid").length;

  const counts: Record<TabKey, number> = {
    take: buckets.take.length,
    mine: buckets.mine.length,
    live: buckets.live.length,
    done: buckets.done.length,
  };

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

        {unpaidMine > 0 && (
          <div className="rounded-lg border border-sunset-500/40 bg-sunset-500/10 px-4 py-3 text-sm text-sunset-200">
            You have {unpaidMine} settled bet{unpaidMine === 1 ? "" : "s"}{" "}
            waiting on payment.{" "}
            <Link href="/side-bets?tab=done" className="underline">
              See them
            </Link>
            .
          </div>
        )}

        {!matchups.ok && <SleeperWarning error={matchups.error} />}

        {matchups.ok && projections.ok && (
          <Card
            title="The board"
            subtitle="Lines built from Sleeper's weekly projections. Click a side to post it as a bet."
          >
            <SuggestedLines
              season={season}
              week={week}
              matchups={matchups.data}
              projections={Object.fromEntries(
                [...projections.data].map(([id, p]) => [id, p.points]),
              )}
              scoringMethod={
                [...projections.data.values()].some((p) => p.method === "generic")
                  ? "generic"
                  : "league"
              }
            />
            <p className="mt-4 text-xs text-white/40">
              Moneylines are priced at fair odds — no vig — so the favourite
              risks more than the underdog. Spreads and totals are set at the
              projected number, so they are straight up: loser pays winner the
              stake. Bets placed from this board grade themselves once the week
              is over.
            </p>
          </Card>
        )}

        {matchups.ok && !projections.ok && (
          <div className="rounded-lg border border-white/10 bg-white/[0.02] px-4 py-3 text-sm text-white/50">
            <strong className="text-white/70">No generated lines this week.</strong>{" "}
            {projections.error}
          </div>
        )}

        {/* ---- Tabs ---- */}
        <div>
          <nav className="flex flex-wrap gap-1 border-b border-white/10">
            {TABS.map((t) => {
              const active = t.key === tab;
              return (
                <Link
                  key={t.key}
                  href={`/side-bets?week=${week}&tab=${t.key}`}
                  className={`-mb-px border-b-2 px-4 py-2.5 text-sm transition ${
                    active
                      ? "border-surf-500 text-white"
                      : "border-transparent text-white/50 hover:text-white/80"
                  }`}
                >
                  {t.label}
                  <span
                    className={`ml-2 rounded-full px-1.5 py-0.5 text-xs ${
                      active ? "bg-surf-500/20 text-surf-300" : "bg-white/5 text-white/40"
                    }`}
                  >
                    {counts[t.key]}
                  </span>
                </Link>
              );
            })}
          </nav>

          <div className="pt-5">
            <TabContents
              tab={tab}
              bets={buckets[tab]}
              userId={user.id}
              isAdmin={user.isAdmin}
            />
          </div>
        </div>

        <Card title="Post your own" subtitle="Be specific. Vague bets start fights.">
          <SideBetForm
            season={season}
            week={week}
            matchups={matchups.ok ? matchups.data : []}
          />
          <p className="mt-3 text-xs text-white/40">
            A bet you write yourself is settled by the commissioner — only bets
            from the board grade automatically.
          </p>
        </Card>
      </Page>
    </>
  );
}

function TabContents({
  tab,
  bets,
  userId,
  isAdmin,
}: {
  tab: TabKey;
  bets: SideBet[];
  userId: number;
  isAdmin: boolean;
}) {
  if (bets.length === 0) {
    const empty: Record<TabKey, string> = {
      take: "Nothing to take right now. Post something from the board above.",
      mine: "You haven't posted anything this week.",
      live: "Nothing matched this week yet.",
      done: "Nothing has been settled this week.",
    };
    return <Empty>{empty[tab]}</Empty>;
  }

  return (
    <ul className="space-y-3">
      {bets.map((bet) => (
        <li
          key={bet.id}
          className="rounded-lg border border-white/10 bg-white/[0.02] p-4"
        >
          <BetCard bet={bet} userId={userId} isAdmin={isAdmin} tab={tab} />
        </li>
      ))}
    </ul>
  );
}

function BetCard({
  bet,
  userId,
  isAdmin,
  tab,
}: {
  bet: SideBet;
  userId: number;
  isAdmin: boolean;
  tab: TabKey;
}) {
  const evenMoney = bet.stakeCents === bet.takerStakeCents;
  const iAmProposer = bet.proposerId === userId;
  const winnerName =
    bet.winner === "proposer"
      ? bet.proposerName
      : bet.winner === "taker"
        ? bet.takerName
        : null;
  const iWon =
    (bet.winner === "proposer" && iAmProposer) ||
    (bet.winner === "taker" && bet.takerId === userId);
  // The loser pays whatever the loser risked.
  const owed =
    bet.winner === "proposer" ? bet.takerStakeCents : bet.stakeCents;

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-medium text-white">{bet.title}</h3>
        <span className="flex items-center gap-2">
          <span className="font-mono text-sm text-sunset-300">
            {evenMoney
              ? formatCents(bet.stakeCents)
              : `${formatCents(bet.stakeCents)} v ${formatCents(bet.takerStakeCents)}`}
          </span>
          <Badge status={bet.status} />
        </span>
      </div>

      {bet.details && <p className="mt-2 text-sm text-white/60">{bet.details}</p>}

      {/* --- Open: show both sides so a taker knows what they're getting --- */}
      {bet.status === "open" && (
        <>
          <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
            <SideBox
              label={`${bet.proposerName} has`}
              value={bet.proposerSide}
              accent={iAmProposer}
            />
            <SideBox
              label={iAmProposer ? "They'd have" : "You'd have"}
              value={bet.takerSide}
              accent={!iAmProposer}
            />
          </div>
          <div className="mt-4">
            {iAmProposer ? (
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
                  Take the other side · put up {formatCents(bet.takerStakeCents)}
                </button>
              </form>
            )}
          </div>
        </>
      )}

      {/* --- Matched: spell out both outcomes --- */}
      {bet.status === "matched" && (
        <>
          <p className="mt-2 text-sm text-white/60">
            <span className="text-white/80">{bet.proposerName}</span> (
            {bet.proposerSide}) vs{" "}
            <span className="text-white/80">{bet.takerName}</span> (
            {bet.takerSide})
          </p>
          <p className="mt-1.5 text-sm text-white/50">
            {bet.proposerName} wins →{" "}
            <span className="text-white/80">
              {bet.takerName} owes {formatCents(bet.takerStakeCents)}
            </span>
            {" · "}
            {bet.takerName} wins →{" "}
            <span className="text-white/80">
              {bet.proposerName} owes {formatCents(bet.stakeCents)}
            </span>
          </p>
          {bet.marketKind ? (
            <p className="mt-2 text-xs text-white/30">
              Grades itself when the week ends.
            </p>
          ) : (
            // A bet somebody wrote themselves cannot be graded in code, so
            // either person in it says who won -- no need to wait on the
            // commissioner.
            (bet.proposerId === userId || bet.takerId === userId || isAdmin) && (
              <div className="mt-3">
                <p className="mb-2 text-xs text-white/40">Who won?</p>
                <div className="flex flex-wrap gap-2">
                  <SettleButton
                    betId={bet.id}
                    winner="proposer"
                    label={`${bet.proposerName} — collects ${formatCents(bet.takerStakeCents)}`}
                  />
                  <SettleButton
                    betId={bet.id}
                    winner="taker"
                    label={`${bet.takerName} — collects ${formatCents(bet.stakeCents)}`}
                  />
                  <SettleButton betId={bet.id} winner="push" label="Push" />
                </div>
              </div>
            )
          )}
        </>
      )}

      {/* --- Graded: who owes what, and a way to say it landed --- */}
      {(bet.status === "unpaid" || bet.status === "paid") && (
        <div className="mt-3">
          <p className="text-sm text-white/70">
            <span className="text-surf-300">{winnerName}</span> won{" "}
            <span className="font-mono">{formatCents(owed)}</span>
            {bet.autoSettled && (
              <span className="ml-2 text-xs text-white/30">settled automatically</span>
            )}
          </p>

          {bet.status === "unpaid" ? (
            iWon || isAdmin ? (
              <form action={markPaidAction} className="mt-3">
                <input type="hidden" name="betId" value={bet.id} />
                <button type="submit" className={buttonClass}>
                  Mark paid
                </button>
              </form>
            ) : (
              <p className="mt-2 text-xs text-white/40">
                {winnerName} confirms when it lands.
              </p>
            )
          ) : (
            <form action={markUnpaidAction} className="mt-3">
              <input type="hidden" name="betId" value={bet.id} />
              <button type="submit" className={ghostButtonClass}>
                Undo paid
              </button>
            </form>
          )}

          {/* Settled to the wrong side, or Push hit by mistake? Only the
              commissioner can reopen it, and only before it is paid. */}
          {isAdmin && bet.status === "unpaid" && (
            <form action={reopenSideBetAction} className="mt-2">
              <input type="hidden" name="betId" value={bet.id} />
              <button type="submit" className={ghostButtonClass}>
                Wrong result — reopen
              </button>
            </form>
          )}
        </div>
      )}

      {bet.status === "void" && (
        <>
          <p className="mt-2 text-sm text-white/50">
            {bet.winner === "push" ? "Push — no money moved." : "Cancelled."}
          </p>
          {isAdmin && bet.winner === "push" && (
            <form action={reopenSideBetAction} className="mt-2">
              <input type="hidden" name="betId" value={bet.id} />
              <button type="submit" className={ghostButtonClass}>
                Pushed by mistake — reopen
              </button>
            </form>
          )}
        </>
      )}
    </>
  );
}

function SettleButton({
  betId,
  winner,
  label,
}: {
  betId: number;
  winner: string;
  label: string;
}) {
  return (
    <form action={settleSideBetAction}>
      <input type="hidden" name="betId" value={betId} />
      <input type="hidden" name="winner" value={winner} />
      <button type="submit" className={ghostButtonClass}>
        {label}
      </button>
    </form>
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
