import Link from "next/link";
import { logoutAction } from "@/lib/actions.ts";
import type { SessionUser } from "@/lib/auth.ts";

/** Shared bits of chrome so every page looks like the same site. */

export function Nav({ user }: { user: SessionUser }) {
  const links = [
    { href: "/", label: "Home" },
    { href: "/parlay", label: "Parlay" },
    { href: "/side-bets", label: "Side Bets" },
    { href: "/ledger", label: "Ledger" },
  ];

  return (
    <header className="border-b border-white/10 bg-deep-900/70 backdrop-blur">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3">
        <Link href="/" className="text-lg font-black tracking-tight">
          <span className="text-sunset-500">🌺</span>{" "}
          <span className="text-surf-300">Hawaii</span>{" "}
          <span className="text-white/90">Fantasy League</span>
        </Link>

        <nav className="flex flex-1 flex-wrap gap-4 text-sm">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="text-white/70 transition hover:text-surf-300"
            >
              {l.label}
            </Link>
          ))}
          {user.isAdmin && (
            <Link
              href="/admin"
              className="text-sunset-300 transition hover:text-sunset-500"
            >
              Commissioner
            </Link>
          )}
        </nav>

        <form action={logoutAction} className="flex items-center gap-3">
          <span className="text-sm text-white/50">{user.displayName}</span>
          <button
            type="submit"
            className="rounded-md border border-white/15 px-2.5 py-1 text-xs text-white/70 transition hover:border-white/40 hover:text-white"
          >
            Sign out
          </button>
        </form>
      </div>
    </header>
  );
}

export function Page({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-5xl px-4 py-8 space-y-8">{children}</main>
  );
}

export function Card({
  title,
  subtitle,
  children,
  accent = false,
}: {
  title?: string;
  subtitle?: string;
  children: React.ReactNode;
  accent?: boolean;
}) {
  return (
    <section
      className={`rounded-xl border p-5 ${
        accent
          ? "border-sunset-500/40 bg-sunset-500/5"
          : "border-white/10 bg-white/[0.03]"
      }`}
    >
      {title && (
        <div className="mb-4">
          <h2 className="text-base font-semibold text-white">{title}</h2>
          {subtitle && (
            <p className="mt-1 text-sm text-white/50">{subtitle}</p>
          )}
        </div>
      )}
      {children}
    </section>
  );
}

const BADGE_STYLES: Record<string, string> = {
  win: "bg-surf-500/20 text-surf-300 border-surf-500/40",
  won: "bg-surf-500/20 text-surf-300 border-surf-500/40",
  loss: "bg-red-500/20 text-red-300 border-red-500/40",
  lost: "bg-red-500/20 text-red-300 border-red-500/40",
  push: "bg-white/10 text-white/60 border-white/20",
  void: "bg-white/10 text-white/60 border-white/20",
  pending: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  open: "bg-sunset-500/20 text-sunset-300 border-sunset-500/40",
  locked: "bg-white/10 text-white/70 border-white/20",
  matched: "bg-surf-500/15 text-surf-300 border-surf-500/30",
  settled: "bg-white/10 text-white/60 border-white/20",
};

export function Badge({ status }: { status: string }) {
  const style = BADGE_STYLES[status] ?? "bg-white/10 text-white/60 border-white/20";
  return (
    <span
      className={`inline-block rounded-full border px-2 py-0.5 text-xs font-medium uppercase tracking-wide ${style}`}
    >
      {status}
    </span>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-lg border border-dashed border-white/15 px-4 py-8 text-center text-sm text-white/40">
      {children}
    </p>
  );
}

/** Shown when Sleeper can't be reached -- never takes the page down with it. */
export function SleeperWarning({ error }: { error: string }) {
  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200/90">
      <strong className="font-semibold">Sleeper data unavailable.</strong>{" "}
      {error} You can still post and settle bets by hand.
    </div>
  );
}

export const inputClass =
  "w-full rounded-md border border-white/15 bg-deep-900/70 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-surf-500 focus:outline-none focus:ring-1 focus:ring-surf-500";

export const buttonClass =
  "rounded-md bg-surf-500 px-4 py-2 text-sm font-semibold text-deep-950 transition hover:bg-surf-300 disabled:opacity-50";

export const ghostButtonClass =
  "rounded-md border border-white/15 px-3 py-1.5 text-xs text-white/70 transition hover:border-white/40 hover:text-white";
