import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth.ts";
import { configProblems } from "@/lib/config.ts";
import SetupNeeded from "@/components/setup-needed.tsx";
import {
  getOrCreateParlay,
  listUnsettledBets,
  listMembers,
} from "@/lib/queries.ts";
import { currentWeek, normaliseWeek } from "@/lib/week.ts";
import { getLeagueUsers } from "@/lib/sleeper.ts";
import { formatCents, formatAmerican } from "@/lib/odds.ts";
import {
  gradeLegAction,
  setParlayStatusAction,
  setStakeAction,
  settleSideBetAction,
  autoSettleAction,
  linkAllSleeperAction,
} from "@/lib/actions.ts";
import {
  Nav,
  Page,
  Card,
  Badge,
  Empty,
  inputClass,
  buttonClass,
  ghostButtonClass,
} from "@/components/ui.tsx";

export const dynamic = "force-dynamic";

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  // Show what needs configuring rather than a bare 500 page.
  const problems = configProblems();
  if (problems.length > 0) return <SetupNeeded problems={problems} />;

  const user = await getCurrentUser();
  if (!user) redirect("/login");
  // Belt and braces: the nav link is hidden for non-admins, but the page
  // checks again. Hiding a link is not access control.
  if (!user.isAdmin) redirect("/");

  const params = await searchParams;
  const ctx = currentWeek();
  const week = normaliseWeek(params.week, ctx.week);

  const leagueId = process.env.SLEEPER_LEAGUE_ID;
  const [parlay, unsettled, members, sleeperUsers] = await Promise.all([
    getOrCreateParlay(ctx.season, week),
    listUnsettledBets(),
    listMembers(),
    leagueId
      ? getLeagueUsers(leagueId)
      : Promise.resolve({ ok: false as const, error: "SLEEPER_LEAGUE_ID isn't set." }),
  ]);

  const linkedCount = members.filter((m) => m.sleeperUserId).length;

  return (
    <>
      <Nav user={user} />
      <Page>
        <div>
          <h1 className="text-2xl font-bold">Commissioner</h1>
          <p className="mt-1 text-sm text-white/50">
            Lock the week, grade the legs, settle the side bets.
          </p>
        </div>

        <Card
          title={`Week ${week} parlay`}
          subtitle="Locking stops anyone from changing their leg."
        >
          <div className="flex flex-wrap items-center gap-3">
            <Badge status={parlay.status} />

            {(["open", "locked", "won", "lost"] as const)
              .filter((s) => s !== parlay.status)
              .map((status) => (
                <form key={status} action={setParlayStatusAction}>
                  <input type="hidden" name="parlayId" value={parlay.id} />
                  <input type="hidden" name="status" value={status} />
                  <button type="submit" className={ghostButtonClass}>
                    Mark {status}
                  </button>
                </form>
              ))}
          </div>

          <form
            action={setStakeAction}
            className="mt-4 flex flex-wrap items-end gap-3"
          >
            <input type="hidden" name="parlayId" value={parlay.id} />
            <div>
              <label htmlFor="stake" className="mb-1.5 block text-sm text-white/70">
                Ticket stake
              </label>
              <input
                id="stake"
                name="stake"
                defaultValue={(parlay.stakeCents / 100).toFixed(2)}
                inputMode="decimal"
                className={`${inputClass} w-32 font-mono`}
              />
            </div>
            <button type="submit" className={buttonClass}>
              Save
            </button>
            <p className="text-xs text-white/40">
              Flat stake for the whole ticket. Defaults to $10 each week.
            </p>
          </form>
        </Card>

        <Card title="Grade the legs">
          {parlay.legs.length === 0 ? (
            <Empty>No legs to grade yet.</Empty>
          ) : (
            <ul className="space-y-3">
              {parlay.legs.map((leg) => (
                <li
                  key={leg.id}
                  className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-white/10 bg-white/[0.02] px-4 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-white/90">
                      {leg.description}
                    </p>
                    <p className="text-xs text-white/40">
                      {leg.displayName} · {formatAmerican(leg.oddsAmerican)}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {(["win", "loss", "push", "pending"] as const).map((s) => (
                      <form key={s} action={gradeLegAction}>
                        <input type="hidden" name="legId" value={leg.id} />
                        <input type="hidden" name="status" value={s} />
                        <button
                          type="submit"
                          className={
                            leg.status === s
                              ? "rounded-md border border-surf-500 bg-surf-500/20 px-2.5 py-1 text-xs font-medium text-surf-300"
                              : ghostButtonClass
                          }
                        >
                          {s}
                        </button>
                      </form>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card
          title="Settle side bets"
          subtitle="Matched bets waiting on a result, across all weeks. Bets placed from the board settle themselves once the week ends — these are the hand-written ones."
        >
          <form action={autoSettleAction} className="mb-4">
            <button type="submit" className={ghostButtonClass}>
              Run auto-settle now
            </button>
          </form>

          {unsettled.length === 0 ? (
            <Empty>Nothing waiting to be settled.</Empty>
          ) : (
            <ul className="space-y-3">
              {unsettled.map((bet) => (
                <li
                  key={bet.id}
                  className="rounded-lg border border-white/10 bg-white/[0.02] p-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm text-white/90">
                      {bet.title}{" "}
                      <span className="text-white/40">· week {bet.week}</span>
                    </span>
                    <span className="font-mono text-sm text-sunset-300">
                      {bet.stakeCents === bet.takerStakeCents
                        ? formatCents(bet.stakeCents)
                        : `${formatCents(bet.stakeCents)} v ${formatCents(bet.takerStakeCents)}`}
                    </span>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    <SettleButton
                      betId={bet.id}
                      winner="proposer"
                      label={`${bet.proposerName} (${bet.proposerSide}) wins — collects ${formatCents(bet.takerStakeCents)}`}
                    />
                    <SettleButton
                      betId={bet.id}
                      winner="taker"
                      label={`${bet.takerName} (${bet.takerSide}) wins — collects ${formatCents(bet.stakeCents)}`}
                    />
                    <SettleButton betId={bet.id} winner="push" label="Push" />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card
          title="Sleeper accounts"
          subtitle="Link each member to their Sleeper account, then save. Uses Sleeper's permanent user id, so it survives team and handle changes."
        >
          {!sleeperUsers.ok ? (
            <p className="text-sm text-white/50">
              Can&apos;t reach Sleeper to list accounts. {sleeperUsers.error}
            </p>
          ) : (
            <form action={linkAllSleeperAction}>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-white/60">
                  <span
                    className={
                      linkedCount === members.length
                        ? "text-surf-300"
                        : "text-sunset-300"
                    }
                  >
                    {linkedCount} of {members.length}
                  </span>{" "}
                  linked
                  {linkedCount < members.length && (
                    <span className="text-white/40">
                      {" "}
                      — the placer can&apos;t be worked out until everyone is
                    </span>
                  )}
                </p>
                <button type="submit" className={buttonClass}>
                  Save all links
                </button>
              </div>

              <ul className="space-y-2">
                {members.map((m) => {
                  const linked = sleeperUsers.data.find(
                    (su) => su.userId === m.sleeperUserId,
                  );
                  return (
                    <li
                      key={m.id}
                      className={`flex flex-wrap items-center gap-3 rounded-md border px-3 py-2 ${
                        m.sleeperUserId
                          ? "border-surf-500/25 bg-surf-500/[0.04]"
                          : "border-white/10"
                      }`}
                    >
                      <span className="min-w-28 flex-1 text-sm text-white/80">
                        {m.displayName}
                        <span className="ml-2 text-xs text-white/30">
                          {m.username}
                        </span>
                        {m.isAdmin && (
                          <span className="ml-2 text-xs text-sunset-300">
                            commissioner
                          </span>
                        )}
                      </span>

                      <span className="w-40 shrink-0 text-xs">
                        {linked ? (
                          <span className="text-surf-300">
                            ✓ @{linked.displayName}
                          </span>
                        ) : m.sleeperUserId ? (
                          <span className="text-amber-300">
                            ✓ linked (not in league)
                          </span>
                        ) : (
                          <span className="text-white/30">not linked</span>
                        )}
                      </span>

                      <select
                        name={`sleeper_${m.id}`}
                        defaultValue={m.sleeperUserId ?? ""}
                        className={`${inputClass} w-56 py-1.5`}
                      >
                        <option value="">— not linked —</option>
                        {sleeperUsers.data.map((su) => (
                          <option key={su.userId} value={su.userId}>
                            @{su.displayName}
                            {su.teamName ? ` · ${su.teamName}` : ""}
                          </option>
                        ))}
                      </select>
                    </li>
                  );
                })}
              </ul>

              <button type="submit" className={`${buttonClass} mt-4`}>
                Save all links
              </button>
            </form>
          )}
          <p className="mt-3 text-xs text-white/40">
            Members themselves are managed with the seed script — see the README.
          </p>
        </Card>
      </Page>
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
