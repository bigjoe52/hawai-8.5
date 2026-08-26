import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth.ts";
import {
  getOrCreateParlay,
  listUnsettledBets,
  listMembers,
} from "@/lib/queries.ts";
import { currentWeek } from "@/lib/week.ts";
import { formatCents, formatAmerican } from "@/lib/odds.ts";
import {
  gradeLegAction,
  setParlayStatusAction,
  setStakeAction,
  settleSideBetAction,
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
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  // Belt and braces: the nav link is hidden for non-admins, but the page
  // checks again. Hiding a link is not access control.
  if (!user.isAdmin) redirect("/");

  const params = await searchParams;
  const ctx = await currentWeek();
  const week = Number(params.week) || ctx.week;

  const [parlay, unsettled, members] = await Promise.all([
    getOrCreateParlay(ctx.season, week),
    listUnsettledBets(),
    listMembers(),
  ]);

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
                Buy-in per person
              </label>
              <input
                id="stake"
                name="stake"
                defaultValue={(parlay.stakePerUserCents / 100).toFixed(2)}
                inputMode="decimal"
                className={`${inputClass} w-32 font-mono`}
              />
            </div>
            <button type="submit" className={buttonClass}>
              Save
            </button>
            <p className="text-xs text-white/40">
              Pot = this × {members.length} players ={" "}
              {formatCents(parlay.stakePerUserCents * members.length)}
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
          subtitle="Matched bets waiting on a result, across all weeks."
        >
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
                      {formatCents(bet.stakeCents)}
                    </span>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    <SettleButton
                      betId={bet.id}
                      winner="proposer"
                      label={`${bet.proposerName} (${bet.proposerSide})`}
                    />
                    <SettleButton
                      betId={bet.id}
                      winner="taker"
                      label={`${bet.takerName} (${bet.takerSide})`}
                    />
                    <SettleButton betId={bet.id} winner="push" label="Push" />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="League members">
          <ul className="grid gap-2 sm:grid-cols-2">
            {members.map((m) => (
              <li
                key={m.id}
                className="flex items-center justify-between rounded-md border border-white/10 px-3 py-2 text-sm"
              >
                <span className="text-white/80">{m.displayName}</span>
                <span className="text-xs text-white/40">
                  {m.username}
                  {m.isAdmin && (
                    <span className="ml-2 text-sunset-300">commissioner</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-white/40">
            Members are managed with the seed script — see the README.
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
        {label} wins
      </button>
    </form>
  );
}
