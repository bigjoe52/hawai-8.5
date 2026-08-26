import type { ConfigProblem } from "@/lib/config.ts";

/**
 * Shown instead of a page when the app is missing configuration. The point is
 * that whoever deployed it can read what to do without opening a log viewer.
 */
export default function SetupNeeded({
  problems,
}: {
  problems: ConfigProblem[];
}) {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-xl">
        <h1 className="text-2xl font-bold text-white">
          <span className="text-sunset-500">🌺</span> Almost there
        </h1>
        <p className="mt-2 text-sm text-white/60">
          The site is deployed but{" "}
          {problems.length === 1
            ? "one setting is"
            : `${problems.length} settings are`}{" "}
          missing. Nobody else can see this page — it only appears when
          something needs configuring.
        </p>

        <ul className="mt-6 space-y-4">
          {problems.map((p) => (
            <li
              key={p.variable}
              className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4"
            >
              <p className="font-mono text-sm text-amber-300">{p.variable}</p>
              <p className="mt-1.5 text-sm text-white/80">{p.problem}</p>
              <p className="mt-2 text-sm text-white/50">{p.fix}</p>
            </li>
          ))}
        </ul>

        <p className="mt-6 text-xs text-white/40">
          After changing environment variables you must redeploy — a running
          deployment keeps the environment it started with.
        </p>
      </div>
    </main>
  );
}
