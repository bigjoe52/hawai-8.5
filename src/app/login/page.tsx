import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth.ts";
import LoginForm from "./login-form.tsx";

export default async function LoginPage() {
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
