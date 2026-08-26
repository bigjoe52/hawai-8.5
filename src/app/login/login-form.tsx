"use client";

import { useActionState } from "react";
import { loginAction, type ActionResult } from "@/lib/actions.ts";
import { inputClass, buttonClass } from "@/components/ui.tsx";

export default function LoginForm() {
  const [state, formAction, pending] = useActionState<ActionResult, FormData>(
    loginAction,
    {},
  );

  return (
    <form action={formAction} className="space-y-4">
      <div>
        <label htmlFor="username" className="mb-1.5 block text-sm text-white/70">
          Username
        </label>
        <input
          id="username"
          name="username"
          autoComplete="username"
          autoFocus
          required
          className={inputClass}
        />
      </div>

      <div>
        <label htmlFor="password" className="mb-1.5 block text-sm text-white/70">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className={inputClass}
        />
      </div>

      {state.error && (
        <p className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {state.error}
        </p>
      )}

      <button type="submit" disabled={pending} className={`${buttonClass} w-full`}>
        {pending ? "Checking..." : "Sign in"}
      </button>
    </form>
  );
}
