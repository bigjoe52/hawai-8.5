import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth.ts";
import { configProblems } from "@/lib/config.ts";
import SetupNeeded from "@/components/setup-needed.tsx";
import { getOrCreateParlay, listMembers } from "@/lib/queries.ts";
import { currentWeek, normaliseWeek } from "@/lib/week.ts";
import { resolvePlacer } from "@/lib/placer.ts";
import { getNflMarkets } from "@/lib/polymarket.ts";
import MarketPicker from "@/components/market-picker.tsx";
import {
  combinedDecimalOdds,
  decimalToAmerican,
  parlayPayoutCents,
  resolveParlay,
  formatCents,
  formatAmerican,
} from "@/lib/odds.ts";
import { Nav, Page, Card, Badge, inputClass, buttonClass, ghostButtonClass } from "@/components/ui.tsx";
import { deleteLegAction } from "@/lib/actions.ts";
import LegForm from "./leg-form.tsx";

export const dynamic = "force-dynamic";

export default async function ParlayPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string; season?: string }>;
}) {
  // Show what needs configuring rather than a bare 500 page.
  const problems = configProblems();
  if (problems.length > 0) return <SetupNeeded problems={problems} />;

  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const params = await searchParams;
  const ctx = await currentWeek();
  const season = Number(params.season) || ctx.season;
  const week = normaliseWeek(params.week, ctx.week);

  const [parlay, members] = await Promise.all([
    getOrCreateParlay(season, week),
    listMembers(),
  ]);

  // Who has to place it, and what they can pick from.
  const [placer, markets] = await Promise.all([
    resolvePlacer(season, week),
    getNflMarkets(),
  ]);

  const myLeg = parlay.legs.find((l) => l.userId === user.id);
  const missing = members.filter(
    (m) => !parlay.legs.some((l) => l.userId === m.id),
  );

  const outcome = resolveParlay(parlay.legs);
  const combined = parlay.legs.length > 0 ? combinedDecimalOdds(parlay.legs) : 1;
  const stake = parlay.stakeCents;

  // What the ticket would return if every remaining leg cashes.
  const hypothetical = parlay.legs.map((l) => ({
    oddsAmerican: l.oddsAmerican,
    status: l.status === "pending" ? ("win" as const) : l.status,
  }));
  const potentialPayout = parlayPayoutCents(hypothetical, stake);

  const busted = parlay.legs.filter((l) => l.status === "loss");

  return (
    <>
      <Nav user={user} />
      <Page>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">
              Week {week} Parlay{" "}
              <span className="text-white/40">· {season}</span>
            </h1>
            <p className="mt-1 text-sm text-white/50">
              Everyone adds one leg. All of them have to hit. Fresh ticket every
              week.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Badge status={parlay.status} />
            <WeekPicker season={season} week={week} />
          </div>
        </div>

        {/* ---- Who is placing it ---- */}
        <div
          className={`rounded-lg border px-4 py-3 text-sm ${
            placer.userId === user.id
              ? "border-sunset-500/50 bg-sunset-500/10 text-sunset-100"
              : "border-white/10 bg-white/[0.02] text-white/70"
          }`}
        >
          {placer.displayName ? (
            <>
              <strong className="font-semibold">
                {placer.userId === user.id
                  ? "You're placing this week's parlay."
                  : `${placer.displayName} is placing this week's parlay.`}
              </strong>{" "}
              <span className="text-white/50">({placer.reason})</span>
            </>
          ) : (
            <>
              <strong className="font-semibold">Placer not decided yet.</strong>{" "}
              <span className="text-white/50">{placer.reason}</span>
            </>
          )}
        </div>

        {/* ---- The ticket ---- */}
        <Card
          accent={outcome === "won"}
          title="The ticket"
          subtitle={
            `${formatCents(stake)} ticket · ` +
            (parlay.legs.length === 0
              ? "nobody has added a leg yet."
              : `${parlay.legs.length} of ${members.length} legs in.`)
          }
        >
          {parlay.legs.length === 0 ? (
            <p className="py-6 text-center text-sm text-white/40">
              Be the first to put a leg on the board.
            </p>
          ) : (
            <ol className="divide-y divide-white/5">
              {parlay.legs.map((leg, i) => (
                <li
                  key={leg.id}
                  className={`flex flex-wrap items-center gap-x-4 gap-y-2 py-3 ${
                    leg.status === "loss" ? "opacity-60" : ""
                  }`}
                >
                  <span className="w-6 shrink-0 text-sm font-mono text-white/30">
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p
                      className={`text-sm text-white ${
                        leg.status === "loss" ? "line-through" : ""
                      }`}
                    >
                      {leg.description}
                    </p>
                    <p className="mt-0.5 text-xs text-white/40">
                      {leg.displayName}
                      {leg.userId === user.id && (
                        <span className="text-surf-300"> · yours</span>
                      )}
                    </p>
                  </div>
                  <span className="font-mono text-sm text-sunset-300">
                    {formatAmerican(leg.oddsAmerican)}
                  </span>
                  <Badge status={leg.status} />
                </li>
              ))}
            </ol>
          )}

          {parlay.legs.length > 0 && (
            <dl className="mt-5 grid gap-4 border-t border-white/10 pt-4 sm:grid-cols-3">
              <Stat
                label="Combined odds"
                value={formatAmerican(decimalToAmerican(combined))}
              />
              <Stat
                label={
                  outcome === "won"
                    ? "Paid out"
                    : outcome === "lost"
                      ? "Payout"
                      : "Pays if it hits"
                }
                value={
                  outcome === "lost"
                    ? "busted"
                    : formatCents(
                        outcome === "won"
                          ? parlayPayoutCents(parlay.legs, stake)
                          : potentialPayout,
                      )
                }
                highlight={outcome === "won"}
                muted={outcome === "lost"}
              />
              <Stat label="Stake" value={formatCents(stake)} />
            </dl>
          )}

          {busted.length > 0 && (
            <p className="mt-4 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
              <strong>Dead ticket.</strong> Busted by{" "}
              {busted.map((l) => l.displayName).join(", ")}. Everyone knows.
            </p>
          )}
        </Card>

        {/* ---- Your leg ---- */}
        {parlay.status === "open" ? (
          <Card
            title={myLeg ? "Your leg" : "Add your leg"}
            subtitle={
              myLeg
                ? "You can change it until the commissioner locks the week."
                : "Pick anything on the NFL slate. One per person."
            }
          >
            {markets.ok ? (
              <div className="mb-5 rounded-lg border border-white/10 bg-deep-900/40 p-4">
                <h3 className="mb-1 text-sm font-medium text-white">
                  Pick from live markets
                </h3>
                <p className="mb-3 text-xs text-white/40">
                  Real prices, so nobody has to guess what a leg is worth.
                </p>
                <MarketPicker markets={markets.data} />
              </div>
            ) : (
              <p className="mb-4 rounded-md border border-white/10 bg-white/[0.02] px-3 py-2 text-xs text-white/40">
                Live market prices unavailable — {markets.error}
              </p>
            )}

            <LegForm parlayId={parlay.id} existing={myLeg ?? null} />
            {myLeg && (
              <form action={deleteLegAction} className="mt-3">
                <input type="hidden" name="legId" value={myLeg.id} />
                <button type="submit" className={ghostButtonClass}>
                  Remove my leg
                </button>
              </form>
            )}
          </Card>
        ) : (
          <Card title="Legs are locked">
            <p className="text-sm text-white/50">
              This week is locked, so legs can&apos;t be added or changed.
            </p>
          </Card>
        )}

        {/* ---- Who is holding it up ---- */}
        {missing.length > 0 && parlay.status === "open" && (
          <Card title="Still waiting on">
            <div className="flex flex-wrap gap-2">
              {missing.map((m) => (
                <span
                  key={m.id}
                  className="rounded-full border border-white/15 px-3 py-1 text-sm text-white/60"
                >
                  {m.displayName}
                </span>
              ))}
            </div>
          </Card>
        )}
      </Page>
    </>
  );
}

function Stat({
  label,
  value,
  highlight = false,
  muted = false,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  muted?: boolean;
}) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-white/40">{label}</dt>
      <dd
        className={`mt-1 font-mono text-lg ${
          highlight ? "text-surf-300" : muted ? "text-white/40" : "text-white"
        }`}
      >
        {value}
      </dd>
    </div>
  );
}

function WeekPicker({ season, week }: { season: number; week: number }) {
  return (
    <form className="flex items-center gap-2">
      <input type="hidden" name="season" value={season} />
      <label htmlFor="week" className="text-xs text-white/40">
        Week
      </label>
      <select
        id="week"
        name="week"
        defaultValue={week}
        className={`${inputClass} w-20 py-1`}
      >
        {Array.from({ length: 18 }, (_, i) => i + 1).map((w) => (
          <option key={w} value={w}>
            {w}
          </option>
        ))}
      </select>
      <button type="submit" className={`${buttonClass} px-3 py-1`}>
        Go
      </button>
    </form>
  );
}
