"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";

function LoginForm() {
  const searchParams = useSearchParams();
  const next = searchParams.get("next") || "/admin/analytics";

  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      if (res.ok) {
        // Full navigation so middleware re-evaluates with the new cookie.
        window.location.assign(next);
        return;
      }
      setError("Incorrect token.");
    } catch {
      setError("Something went wrong. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex w-full flex-1 items-center justify-center">
      <form
        onSubmit={handleSubmit}
        className="dot-bg w-full overflow-hidden rounded-[28px] border-[2.5px] border-ink bg-base px-[22px] pb-9 pt-[30px] shadow-[8px_8px_0_#1b1813]"
      >
        <h1 className="text-center font-display text-[22px] font-bold text-ink">
          Analytics admin
        </h1>
        <p className="mt-2 text-center font-bold text-sm text-muted">
          Enter the read token to continue.
        </p>

        <input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="Read token"
          autoComplete="current-password"
          className="mt-6 w-full rounded-[14px] border-[2.5px] border-ink bg-surface px-4 py-3.5 font-bold text-sm text-ink shadow-[3px_3px_0_#1b1813] outline-none placeholder:text-muted"
        />

        {error && (
          <p className="mt-3 text-center font-bold text-sm text-wrong">{error}</p>
        )}

        <button
          type="submit"
          disabled={submitting || token.length === 0}
          className="mt-5 w-full rounded-2xl border-[2.5px] border-ink bg-correct py-[16px] font-display text-[17px] font-bold text-white shadow-[5px_5px_0_#1b1813] transition active:translate-x-0.5 active:translate-y-0.5 active:shadow-none disabled:opacity-60"
        >
          {submitting ? "Checking…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}

export default function AdminLoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
