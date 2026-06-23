import {
  ANALYTICS_EVENT_NAMES,
  getEvents,
  getSummary,
  type AnalyticsEventRow,
  type AnalyticsSummary,
} from "@/lib/analytics-store";
import { parseFilters } from "@/lib/analytics-filters";
import LogoutButton from "./LogoutButton";

// Reads live data per request; never statically cached.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

const EVENT_LABELS: Record<string, string> = {
  quiz_started: "Quiz started",
  hint_revealed: "Hint revealed",
  quiz_completed: "Quiz completed",
  share_result: "Share (native)",
  share_x: "Share to X",
  share_whatsapp: "Share to WhatsApp",
};

function StatCard({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-[14px] border-[2.5px] border-ink bg-surface px-3 py-3.5 text-center shadow-[3px_3px_0_#1b1813]">
      <div className="font-display text-[26px] font-bold leading-none text-ink tabular-nums">
        {value}
      </div>
      <div className="mt-1.5 font-extrabold text-[9px] uppercase tracking-[1px] text-muted">
        {label}
      </div>
    </div>
  );
}

function pct(value: number | null): string {
  return value == null ? "—" : `${Math.round(value * 100)}%`;
}

function num(value: number | null, digits = 0): string {
  return value == null ? "—" : value.toFixed(digits);
}

function eventDetails(row: AnalyticsEventRow): string {
  if (row.eventName === "hint_revealed") {
    return `${row.hintKey ?? "?"} (player ${row.playerIndex != null ? row.playerIndex + 1 : "?"})`;
  }
  if (row.eventName === "quiz_completed") {
    return `${row.correctCount ?? "?"} correct · ${row.score ?? "?"}/${row.maxScore ?? "?"}`;
  }
  return "—";
}

export default async function AdminAnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(sp)) {
    if (typeof value === "string") params.set(key, value);
  }
  const filters = parseFilters(params);

  let summary: AnalyticsSummary | null = null;
  let events: AnalyticsEventRow[] = [];
  let error: string | null = null;
  try {
    [summary, events] = await Promise.all([getSummary(filters), getEvents(filters)]);
  } catch {
    error =
      "Could not reach the analytics store. Is DATABASE_URL configured and migrated?";
  }

  const inputClass =
    "rounded-[12px] border-[2.5px] border-ink bg-surface px-3 py-2.5 font-bold text-sm text-ink shadow-[2px_2px_0_#1b1813] outline-none";

  return (
    // Full-bleed: escape the narrow centered column from the root layout.
    <div className="relative left-1/2 w-screen -translate-x-1/2 px-4">
      <div className="mx-auto max-w-[1024px]">
        <div className="flex items-center justify-between gap-3">
          <h1 className="font-display text-[24px] font-bold text-ink">Quiz analytics</h1>
          <LogoutButton />
        </div>

        {/* ── Filters (GET form → query params) ─────────────────────────── */}
        <form
          method="get"
          className="mt-5 flex flex-wrap items-end gap-3 rounded-[18px] border-[2.5px] border-ink bg-base p-4 shadow-[4px_4px_0_#1b1813]"
        >
          <label className="flex flex-col gap-1 font-extrabold text-[10px] uppercase tracking-[1px] text-muted">
            From
            <input type="date" name="from" defaultValue={params.get("from") ?? ""} className={inputClass} />
          </label>
          <label className="flex flex-col gap-1 font-extrabold text-[10px] uppercase tracking-[1px] text-muted">
            To
            <input type="date" name="to" defaultValue={params.get("to") ?? ""} className={inputClass} />
          </label>
          <label className="flex flex-col gap-1 font-extrabold text-[10px] uppercase tracking-[1px] text-muted">
            Quiz type
            <select name="quizType" defaultValue={filters.quizType ?? "all"} className={inputClass}>
              <option value="all">All</option>
              <option value="daily">Daily</option>
              <option value="random">Random</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 font-extrabold text-[10px] uppercase tracking-[1px] text-muted">
            Event
            <select name="eventName" defaultValue={params.get("eventName") ?? ""} className={inputClass}>
              <option value="">All</option>
              {ANALYTICS_EVENT_NAMES.map((name) => (
                <option key={name} value={name}>
                  {EVENT_LABELS[name]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 font-extrabold text-[10px] uppercase tracking-[1px] text-muted">
            Puzzle #
            <input
              type="number"
              name="puzzleNumber"
              min={1}
              defaultValue={params.get("puzzleNumber") ?? ""}
              className={`${inputClass} w-24`}
            />
          </label>
          <button
            type="submit"
            className="rounded-[12px] border-[2.5px] border-ink bg-active px-5 py-2.5 font-display text-sm font-bold text-white shadow-[3px_3px_0_#1b1813] transition active:translate-x-0.5 active:translate-y-0.5 active:shadow-none"
          >
            Apply
          </button>
          <a
            href="/admin/analytics"
            className="rounded-[12px] border-[2.5px] border-ink bg-surface px-5 py-2.5 font-display text-sm font-bold text-ink shadow-[3px_3px_0_#1b1813]"
          >
            Reset
          </a>
        </form>

        {error ? (
          <div className="mt-6 rounded-[18px] border-[2.5px] border-ink bg-wrong-soft p-5 font-bold text-sm text-ink shadow-[4px_4px_0_#1b1813]">
            {error}
          </div>
        ) : (
          summary && (
            <>
              {/* ── Aggregate stat cards ──────────────────────────────── */}
              <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                <StatCard value={String(summary.totalEvents)} label="Total events" />
                <StatCard value={String(summary.uniqueUsers)} label="Unique users" />
                <StatCard value={String(summary.byEvent.quiz_started)} label="Quizzes started" />
                <StatCard value={String(summary.completion.plays)} label="Quizzes completed" />
                <StatCard value={pct(summary.completion.completionRate)} label="Completion rate" />
                <StatCard value={num(summary.completion.avgScore, 0)} label="Avg score" />
              </div>

              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                <StatCard value={num(summary.completion.avgCorrect, 1)} label="Avg correct" />
                <StatCard value={String(summary.byEvent.hint_revealed)} label="Hints used" />
                <StatCard value={String(summary.hintsByKey.continent)} label="Hint · continent" />
                <StatCard value={String(summary.hintsByKey.fact)} label="Hint · clue" />
                <StatCard value={String(summary.hintsByKey.club)} label="Hint · club" />
                <StatCard value={String(summary.hintsByKey.name)} label="Hint · name" />
              </div>

              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
                <StatCard value={String(summary.byEvent.share_result)} label="Shares · native" />
                <StatCard value={String(summary.byEvent.share_x)} label="Shares · X" />
                <StatCard value={String(summary.byEvent.share_whatsapp)} label="Shares · WhatsApp" />
              </div>

              {/* ── Raw event table ───────────────────────────────────── */}
              <h2 className="mt-8 font-display text-[18px] font-bold text-ink">
                Raw events{" "}
                <span className="font-bold text-sm text-muted">
                  ({events.length} most recent)
                </span>
              </h2>
              <div className="mt-3 overflow-x-auto rounded-[18px] border-[2.5px] border-ink bg-surface shadow-[4px_4px_0_#1b1813]">
                <table className="w-full border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b-[2.5px] border-ink font-extrabold text-[10px] uppercase tracking-[1px] text-muted">
                      <th className="px-3 py-2.5">Time (UTC)</th>
                      <th className="px-3 py-2.5">Event</th>
                      <th className="px-3 py-2.5">User</th>
                      <th className="px-3 py-2.5">Type</th>
                      <th className="px-3 py-2.5">Puzzle</th>
                      <th className="px-3 py-2.5">Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {events.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-3 py-6 text-center font-bold text-muted">
                          No events match these filters yet.
                        </td>
                      </tr>
                    ) : (
                      events.map((row) => (
                        <tr key={row.id} className="border-b border-ink/10 last:border-0">
                          <td className="whitespace-nowrap px-3 py-2.5 font-mono text-[12px] text-ink">
                            {row.createdAt.replace("T", " ").slice(0, 19)}
                          </td>
                          <td className="px-3 py-2.5 font-bold text-ink">
                            {EVENT_LABELS[row.eventName] ?? row.eventName}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2.5 font-mono text-[12px] text-muted">
                            {row.userId.slice(0, 8)}…
                          </td>
                          <td className="px-3 py-2.5 font-bold text-ink">
                            {row.isDailyQuiz ? "Daily" : "Random"}
                          </td>
                          <td className="px-3 py-2.5 tabular-nums text-ink">
                            {row.puzzleNumber ?? "—"}
                          </td>
                          <td className="px-3 py-2.5 text-ink">{eventDetails(row)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )
        )}
      </div>
    </div>
  );
}
