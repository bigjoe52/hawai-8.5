import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth.ts";
import { configProblems } from "@/lib/config.ts";
import SetupNeeded from "@/components/setup-needed.tsx";

// Never prerender this at build time. It reads configuration and cookies,
// both of which only exist per-request -- prerendering would freeze whatever
// the build environment happened to look like into a cached page.
export const dynamic = "force-dynamic";
import LoginForm from "./login-form.tsx";

export default async function LoginPage() {
  // Show what needs configuring rather than a bare 500 page.
  const problems = configProblems();
  if (problems.length > 0) return <SetupNeeded problems={problems} />;

  // Already signed in? Straight to the dashboard.
  if (await getCurrentUser()) redirect("/");

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-black tracking-tight">
            <span className="text-sunset-500">🌺</span>{" "}
            <span className="text-surf-300">Hawaii</span>{" "}
            <span className="text-white/90">Fantasy League</span>
          </h1>
          <p className="mt-2 text-sm text-white/50">
            Ten guys. One parlay. Endless arguing.
          </p>
        </div>

        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-6">
          <LoginForm />
        </div>

        <p className="mt-6 text-center text-xs text-white/30">
          No account? The commissioner hands those out.
        </p>
      </div>
    </main>
  );
}
