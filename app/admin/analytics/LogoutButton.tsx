"use client";

/** Clears the session cookie, then returns to the login screen. */
export default function LogoutButton() {
  async function signOut() {
    try {
      await fetch("/api/admin/login", { method: "DELETE" });
    } catch {
      // Ignore — navigate regardless so the user isn't stuck.
    }
    window.location.assign("/admin/login");
  }

  return (
    <button
      type="button"
      onClick={signOut}
      className="rounded-[12px] border-[2.5px] border-ink bg-surface px-4 py-2.5 font-display text-sm font-bold text-ink shadow-[3px_3px_0_#1b1813] transition active:translate-x-0.5 active:translate-y-0.5 active:shadow-none"
    >
      Sign out
    </button>
  );
}
