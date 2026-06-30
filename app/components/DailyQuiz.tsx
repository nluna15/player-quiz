"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import type { Country, Player } from "@/lib/quiz";
import { continentOf, factOf, getPuzzleNumber, getTodayDateString } from "@/lib/quiz";
import { buildShareGrid, buildShareText } from "@/lib/share";
import { trackQuizEvent } from "@/lib/analytics";
import CountryTypeahead from "./CountryTypeahead";

type HintKey = "continent" | "fact" | "club" | "name";

type Entry = {
  guessedCode: string | null;
  correct: boolean;
  hints: HintKey[]; // which hints have been revealed for this player
};

type Props = {
  players: Player[];
  countries: Country[];
  dateStr: string;
  seed: string;
};

// Full value for a correct pick; each revealed hint subtracts its cost.
const FULL_POINTS = 100;

// Available hints, in display order. Single source of truth for label/cost.
const HINTS: { key: HintKey; emoji: string; label: string; cost: number }[] = [
  { key: "continent", emoji: "🌍", label: "Continent", cost: 5 },
  { key: "fact", emoji: "🧩", label: "Country clue", cost: 25 },
  { key: "club", emoji: "🏟️", label: "Club", cost: 10 },
  { key: "name", emoji: "🕵️", label: "Player name", cost: 15 },
];

const HINT_COST: Record<HintKey, number> = Object.fromEntries(
  HINTS.map((h) => [h.key, h.cost])
) as Record<HintKey, number>;

function hintsCost(hints: HintKey[]): number {
  return hints.reduce((sum, key) => sum + (HINT_COST[key] ?? 0), 0);
}

function entryPoints(e: Entry): number {
  return e.correct ? Math.max(0, FULL_POINTS - hintsCost(e.hints)) : 0;
}

function freshEntries(count: number): Entry[] {
  return Array.from({ length: count }, () => ({
    guessedCode: null,
    correct: false,
    hints: [],
  }));
}

/** Normalize a persisted entry, migrating the old `hintLevel` shape to `hints`. */
function normalizeEntry(raw: unknown): Entry {
  const e = (raw ?? {}) as Partial<Entry> & { hintLevel?: number };
  const hints = Array.isArray(e.hints)
    ? e.hints.filter(
        (h): h is HintKey =>
          h === "continent" || h === "fact" || h === "club" || h === "name"
      )
    : typeof e.hintLevel === "number" && e.hintLevel >= 1
      ? (["club"] as HintKey[])
      : [];
  return {
    guessedCode: typeof e.guessedCode === "string" ? e.guessedCode : null,
    correct: e.correct === true,
    hints,
  };
}

// ── Daily streak (localStorage) ──────────────────────────────────────────
const STREAK_KEY = "quiz-streak";

function dayBefore(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** Streak to display today: the stored count if last played was today or
 *  yesterday, otherwise 0 (the run has lapsed). */
function readStreak(today: string): number {
  try {
    const raw = localStorage.getItem(STREAK_KEY);
    if (!raw) return 0;
    const { lastDate, count } = JSON.parse(raw) as { lastDate: string; count: number };
    if (lastDate === today || lastDate === dayBefore(today)) return count;
  } catch {
    // Ignore malformed storage.
  }
  return 0;
}

/** Record that today's quiz was completed, extending or resetting the streak. */
function bumpStreak(today: string): number {
  let count = 1;
  try {
    const raw = localStorage.getItem(STREAK_KEY);
    if (raw) {
      const prev = JSON.parse(raw) as { lastDate: string; count: number };
      if (prev.lastDate === today) {
        count = prev.count; // already counted today
      } else if (prev.lastDate === dayBefore(today)) {
        count = prev.count + 1;
      }
    }
    localStorage.setItem(STREAK_KEY, JSON.stringify({ lastDate: today, count }));
  } catch {
    // Ignore quota / privacy-mode errors.
  }
  return count;
}

// ── Score history & statistics (localStorage) ─────────────────────────────
const STATS_KEY = "quiz-stats";

/** One completed daily quiz, keyed by date so re-finishing a day can't double-count. */
type DayResult = { score: number; correct: number; n: number };
type StatsStore = { byDate: Record<string, DayResult> };

/** Aggregate numbers derived from the saved history, ready for display. */
type StatsSummary = {
  played: number;
  avgScore: number;
  bestScore: number;
  avgCorrect: number;
  maxStreak: number;
  /** dist[k] = number of games with exactly k correct (index 0..maxN). */
  dist: number[];
  maxN: number;
};

function readStatsStore(): StatsStore {
  try {
    const raw = localStorage.getItem(STATS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<StatsStore>;
      if (parsed && typeof parsed.byDate === "object" && parsed.byDate) {
        return { byDate: parsed.byDate as Record<string, DayResult> };
      }
    }
  } catch {
    // Ignore malformed storage.
  }
  return { byDate: {} };
}

/** Record today's finished result. Idempotent: the last write for a date wins. */
function recordResult(date: string, result: DayResult): void {
  try {
    const store = readStatsStore();
    store.byDate[date] = result;
    localStorage.setItem(STATS_KEY, JSON.stringify(store));
  } catch {
    // Ignore quota / privacy-mode errors.
  }
}

/** Longest run of consecutive calendar days present in the history. */
function longestStreak(dates: string[]): number {
  const set = new Set(dates);
  let best = 0;
  for (const date of dates) {
    // Only count from the start of a run to avoid recomputing mid-run.
    if (set.has(dayBefore(date))) continue;
    let len = 1;
    let cursor = date;
    while (set.has((cursor = nextDay(cursor)))) len++;
    best = Math.max(best, len);
  }
  return best;
}

function nextDay(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Fold the saved history into the summary numbers shown in the Statistics modal. */
function summarizeStats(): StatsSummary {
  const { byDate } = readStatsStore();
  const dates = Object.keys(byDate);
  const results = dates.map((d) => byDate[d]);
  const played = results.length;
  const maxN = results.reduce((m, r) => Math.max(m, r.n), 0);
  const dist = Array.from({ length: maxN + 1 }, () => 0);
  let totalScore = 0;
  let bestScore = 0;
  let totalCorrect = 0;
  for (const r of results) {
    totalScore += r.score;
    totalCorrect += r.correct;
    bestScore = Math.max(bestScore, r.score);
    if (r.correct >= 0 && r.correct <= maxN) dist[r.correct]++;
  }
  return {
    played,
    avgScore: played ? Math.round(totalScore / played) : 0,
    bestScore,
    avgCorrect: played ? totalCorrect / played : 0,
    maxStreak: longestStreak(dates),
    dist,
    maxN,
  };
}

// ── Small presentational pieces ───────────────────────────────────────────
function Logo({ size = "sm" }: { size?: "sm" | "lg" }) {
  const big = size === "lg";
  return (
    <div className="text-center">
      <div
        className={`inline-block -rotate-[1.3deg] rounded-2xl border-[2.5px] border-ink bg-ink font-display font-bold text-white shadow-[4px_4px_0_#ffd23f] ${
          big ? "px-5 py-3 text-[26px]" : "px-[18px] py-2.5 text-[21px]"
        }`}
      >
        ⚽ Where You From?
      </div>
    </div>
  );
}

function StatTile({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex-1 rounded-[14px] border-[2.5px] border-ink bg-surface px-2 py-3 text-center shadow-[3px_3px_0_#1b1813]">
      <div className="font-display text-[26px] font-bold leading-none text-ink tabular-nums">
        {value}
      </div>
      <div className="mt-1.5 font-extrabold text-[9px] uppercase tracking-[1px] text-muted">
        {label}
      </div>
    </div>
  );
}

/** One day in the "you vs. everyone" comparison chart. */
type DailyAvg = {
  date: string; // YYYY-MM-DD
  puzzleNumber: number;
  avgScore: number | null; // community average; null until someone finishes that day
  plays: number;
  userScore: number | null; // this device's score that day, from local history
};

/** Format a YYYY-MM-DD date as "Month Day, Year" (e.g. "June 23, 2026"). */
function formatLongDate(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Short axis label for a date: "Today" for today, otherwise the weekday. */
function dayLabel(date: string): string {
  if (date === getTodayDateString()) return "Today";
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short",
    timeZone: "UTC",
  });
}

/**
 * Horizontal bars of the community average score over the last few daily
 * puzzles, with the player's own score drawn as a vertical hash on the same
 * scale — so they can see where they land against everyone else.
 */
function DailyAvgChart({ days }: { days: DailyAvg[] }) {
  // One shared scale for bars and hashes, so the hash position is comparable.
  const scaleMax = Math.max(
    1,
    ...days.map((d) => Math.max(d.avgScore ?? 0, d.userScore ?? 0))
  );
  return (
    <div className="flex flex-col gap-2">
      {days.map((d) => {
        const avgPct = ((d.avgScore ?? 0) / scaleMax) * 100;
        const hasUser = d.userScore != null;
        const userPct = hasUser ? (d.userScore! / scaleMax) * 100 : 0;
        return (
          <div key={d.date} className="flex items-center gap-2">
            <span className="w-10 shrink-0 text-right font-extrabold text-[10px] uppercase tracking-[0.5px] text-muted">
              {dayLabel(d.date)}
            </span>
            <div className="relative h-[22px] flex-1 rounded-[7px] border-2 border-ink bg-surface">
              {/* Community average fill. */}
              <div
                className="h-full rounded-[5px] bg-hint"
                style={{ width: `${Math.min(100, Math.max(2, avgPct))}%` }}
              />
              {/* The player's own score, as a vertical hash on the same scale. */}
              {hasUser && (
                <div
                  className="absolute top-[-4px] bottom-[-4px] w-[3px] -translate-x-1/2 rounded-full bg-correct"
                  style={{ left: `${Math.min(100, userPct)}%` }}
                  aria-label={`Your score: ${d.userScore}`}
                  title={`Your score: ${d.userScore}`}
                />
              )}
            </div>
            <span className="w-7 shrink-0 text-right font-extrabold text-[11px] text-ink tabular-nums">
              {d.avgScore == null ? "—" : d.avgScore}
            </span>
          </div>
        );
      })}
      <div className="mt-1 flex items-center justify-center gap-3 font-bold text-[10px] text-muted">
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-3 rounded-[2px] border border-ink bg-hint" />
          Avg score
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-3 w-[3px] rounded-full bg-correct" />
          You
        </span>
      </div>
    </div>
  );
}

/** Modal with lifetime score statistics, with today's result highlighted. */
function StatsModal({
  stats,
  streak,
  todayCorrect,
  dailyAvgs,
  onClose,
}: {
  stats: StatsSummary;
  streak: number;
  todayCorrect: number | null;
  dailyAvgs: DailyAvg[] | null;
  onClose: () => void;
}) {
  const maxBar = Math.max(1, ...stats.dist);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Statistics"
      onClick={onClose}
    >
      <div
        className="dot-bg w-full max-w-[420px] overflow-hidden rounded-[28px] border-[2.5px] border-ink bg-base px-5 pb-6 pt-5 shadow-[8px_8px_0_#1b1813]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="font-display text-[22px] font-bold text-ink">Statistics</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close statistics"
            className="grid size-9 place-items-center rounded-full border-[2.5px] border-ink bg-surface font-display text-base font-bold text-ink shadow-[3px_3px_0_#1b1813] transition active:translate-x-0.5 active:translate-y-0.5 active:shadow-none"
          >
            ✕
          </button>
        </div>

        {stats.played === 0 ? (
          <p className="mt-6 mb-2 text-center font-bold text-sm leading-snug text-muted">
            Finish a daily quiz to start building your stats.
          </p>
        ) : (
          <>
            <div className="mt-5 flex gap-2">
              <StatTile value={String(stats.played)} label="Played" />
              <StatTile value={String(stats.avgScore)} label="Avg score" />
              <StatTile value={String(stats.bestScore)} label="Best score" />
            </div>
            <div className="mt-2 flex gap-2">
              <StatTile value={`🔥 ${streak}`} label="Streak" />
              <StatTile value={String(stats.maxStreak)} label="Max streak" />
              <StatTile value={stats.avgCorrect.toFixed(1)} label="Avg correct" />
            </div>

            <div className="mt-5 mb-2.5 font-extrabold text-[11px] uppercase tracking-[1.5px] text-muted">
              Correct distribution
            </div>
            <div className="flex flex-col gap-1.5">
              {stats.dist
                .map((count, k) => ({ count, k }))
                .reverse()
                .map(({ count, k }) => {
                  const isToday = k === todayCorrect;
                  return (
                    <div key={k} className="flex items-center gap-2">
                      <span className="w-4 shrink-0 text-right font-extrabold text-[13px] text-ink tabular-nums">
                        {k}
                      </span>
                      <div className="flex-1">
                        <div
                          className={`flex h-[22px] min-w-[26px] items-center justify-end rounded-[7px] border-2 border-ink px-2 font-extrabold text-[12px] tabular-nums shadow-[2px_2px_0_#1b1813] ${
                            isToday ? "bg-correct text-white" : "bg-hint text-ink"
                          }`}
                          style={{ width: `${Math.max(8, (count / maxBar) * 100)}%` }}
                        >
                          {count}
                        </div>
                      </div>
                    </div>
                  );
                })}
            </div>

            {dailyAvgs && dailyAvgs.length > 0 && (
              <>
                <div className="mt-5 mb-2.5 font-extrabold text-[11px] uppercase tracking-[1.5px] text-muted">
                  Last 5 days · avg score
                </div>
                <DailyAvgChart days={dailyAvgs} />
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default function DailyQuiz({ players, countries, dateStr, seed }: Props) {
  const router = useRouter();
  const storageKey = `quiz-progress-${seed}`;
  const isDaily = seed === dateStr;
  const n = players.length;

  // Load a fresh random quiz (handy for testing multiple quizzes back-to-back).
  function loadNewQuiz() {
    router.push(`/?seed=r${Date.now().toString(36)}`);
  }

  const [entries, setEntries] = useState<Entry[]>(() => freshEntries(n));
  const [currentIndex, setCurrentIndex] = useState(0);
  const [started, setStarted] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [streak, setStreak] = useState(0);
  const [shareStatus, setShareStatus] = useState<"idle" | "copied">("idle");
  // Snapshot of saved stats, read fresh from storage each time the modal opens.
  const [stats, setStats] = useState<StatsSummary | null>(null);
  // Community daily averages + this device's scores, loaded when the modal opens.
  const [dailyAvgs, setDailyAvgs] = useState<DailyAvg[] | null>(null);

  const countryByCode = useMemo(() => {
    const map = new Map<string, Country>();
    for (const c of countries) map.set(c.code, c);
    return map;
  }, [countries]);

  // Context attached to every analytics event for this quiz.
  const analyticsCtx = useMemo(
    () => ({ puzzleNumber: getPuzzleNumber(dateStr), seed, isDailyQuiz: isDaily }),
    [dateStr, seed, isDaily]
  );

  // Restore saved progress for today (if any) once on mount.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const saved = JSON.parse(raw) as { entries: unknown[]; currentIndex: number };
        if (Array.isArray(saved.entries) && saved.entries.length === n) {
          const restored = saved.entries.map(normalizeEntry);
          // Restoring persisted state on mount legitimately needs setState here.
          /* eslint-disable react-hooks/set-state-in-effect */
          setEntries(restored);
          setCurrentIndex(Math.min(saved.currentIndex, n));
          // Skip the landing screen if they've already begun.
          if (saved.currentIndex > 0 || restored.some((e) => e.guessedCode != null)) {
            setStarted(true);
          }
          /* eslint-enable react-hooks/set-state-in-effect */
        }
      }
    } catch {
      // Ignore malformed storage.
    }
    setStreak(readStreak(dateStr));
    setHydrated(true);
  }, [storageKey, n, dateStr]);

  // Persist progress whenever it changes (after hydration).
  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify({ entries, currentIndex }));
    } catch {
      // Ignore quota / privacy-mode errors.
    }
  }, [entries, currentIndex, hydrated, storageKey]);

  const finished = currentIndex >= n;
  const current = finished ? null : players[currentIndex];
  const currentEntry = finished ? null : entries[currentIndex];

  const correctCount = entries.filter((e) => e.correct).length;
  const score = entries.reduce((sum, e) => sum + entryPoints(e), 0);
  const maxScore = n * FULL_POINTS;

  // Report completion exactly once per seed, surviving refreshes on the
  // results screen by recording the fire in localStorage.
  useEffect(() => {
    if (!hydrated || !finished) return;
    const key = `quiz-analytics-completed-${seed}`;
    try {
      if (localStorage.getItem(key)) return;
      localStorage.setItem(key, "1");
    } catch {
      // If storage is unavailable we may double-count; acceptable for analytics.
    }
    trackQuizEvent({ name: "quiz_completed", score, maxScore, correctCount }, analyticsCtx);
  }, [hydrated, finished, seed, score, maxScore, correctCount, analyticsCtx]);

  function revealHint(key: HintKey) {
    const alreadyRevealed = entries[currentIndex]?.hints.includes(key) ?? false;
    setEntries((prev) =>
      prev.map((e, i) =>
        i === currentIndex && !e.hints.includes(key)
          ? { ...e, hints: [...e.hints, key] }
          : e
      )
    );
    if (!alreadyRevealed) {
      trackQuizEvent(
        { name: "hint_revealed", playerIndex: currentIndex, hintKey: key },
        analyticsCtx
      );
    }
  }

  function handleGuess(country: Country) {
    if (!current) return;
    const correct = country.code === current.countryCode;
    setEntries((prev) =>
      prev.map((e, i) =>
        i === currentIndex ? { ...e, guessedCode: country.code, correct } : e
      )
    );
  }

  function nextPlayer() {
    const next = currentIndex + 1;
    // Lock in the daily streak and stats the moment the last player is answered.
    if (next >= n && isDaily) {
      setStreak(bumpStreak(dateStr));
      recordResult(dateStr, { score, correct: correctCount, n });
    }
    setCurrentIndex(next);
  }

  function openStats() {
    setStats(summarizeStats());
    setDailyAvgs(null);
    void loadDailyAverages();
  }

  /** Fetch the community averages and merge in this device's own daily scores. */
  async function loadDailyAverages() {
    try {
      const res = await fetch("/api/stats/daily-averages");
      if (!res.ok) return;
      const data = (await res.json()) as {
        days: { date: string; puzzleNumber: number; avgScore: number | null; plays: number }[];
      };
      const { byDate } = readStatsStore();
      setDailyAvgs(
        data.days.map((d) => ({
          ...d,
          userScore: byDate[d.date]?.score ?? null,
        }))
      );
    } catch {
      // Best-effort: the chart simply stays hidden if this fails.
    }
  }
  const answered = currentEntry?.guessedCode != null;

  function shareText(platform: "default" | "x" = "default") {
    return buildShareText({
      puzzleNumber: getPuzzleNumber(dateStr),
      correctCount,
      totalPlayers: n,
      score,
      entries,
      platform,
    });
  }

  async function handleShare() {
    trackQuizEvent({ name: "share_result" }, analyticsCtx);
    const text = shareText();
    // Prefer the OS-native share sheet when available.
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ text });
        return;
      } catch {
        // User dismissed the sheet, or it failed — fall back to copy.
      }
    }
    try {
      await navigator.clipboard.writeText(text);
      setShareStatus("copied");
      setTimeout(() => setShareStatus("idle"), 1600);
    } catch {
      // Clipboard unavailable — nothing more we can do.
    }
  }

  function handleShareToX() {
    trackQuizEvent({ name: "share_x" }, analyticsCtx);
    const url = `https://x.com/intent/tweet?text=${encodeURIComponent(shareText("x"))}`;
    window.open(url, "_blank", "noopener,noreferrer");
  }

  function handleShareToWhatsApp() {
    trackQuizEvent({ name: "share_whatsapp" }, analyticsCtx);
    const url = `https://wa.me/?text=${encodeURIComponent(shareText())}`;
    window.open(url, "_blank", "noopener,noreferrer");
  }

  const cardShell =
    "dot-bg overflow-hidden rounded-[28px] border-[2.5px] border-ink shadow-[8px_8px_0_#1b1813]";

  // ── Landing screen ───────────────────────────────────────────────────────
  // Shown by default until localStorage is read, so first-time visitors and
  // server render agree (returning players are advanced past it on hydrate).
  if (!hydrated || (!finished && !started)) {
    const steps = [
      { n: "1", bg: "bg-correct", fg: "text-white", text: "Guess each player's national team." },
      { n: "2", bg: "bg-hint", fg: "text-ink", text: "Stuck? Use hints. No shame, but no glory." },
      { n: "3", bg: "bg-active", fg: "text-white", text: "Share your score & beat your friends." },
    ];
    return (
      <main className="flex w-full flex-1 items-center justify-center">
        <div className={`w-full ${cardShell} px-[22px] pb-9 pt-[30px]`}>
          <Logo size="lg" />

          <div className="mt-7 text-center font-display text-[22px] font-bold leading-tight text-ink">
            48 nations.
            <br />
            1,248 players.
            <br />
            {n} players a day.
            <br />
            One daily chance at glory.
          </div>

          {streak > 0 && (
            <div className="mt-3.5 text-center">
              <span className="inline-block rotate-[1.5deg] rounded-full border-[2.5px] border-ink bg-hint px-3.5 py-2 font-extrabold text-[13px] text-ink shadow-[3px_3px_0_#1b1813]">
                🔥 {streak}-day streak
              </span>
            </div>
          )}

          <div className="mt-6 rounded-[18px] border-[2.5px] border-ink bg-surface p-[18px] shadow-[5px_5px_0_#1b1813]">
            <div className="mb-3.5 font-extrabold text-[11px] uppercase tracking-[1.5px] text-muted">
              How to play
            </div>
            <div className="flex flex-col gap-3">
              {steps.map((s) => (
                <div key={s.n} className="flex items-center gap-3">
                  <span
                    className={`grid size-[30px] shrink-0 place-items-center rounded-[9px] border-2 border-ink font-display text-sm font-bold ${s.bg} ${s.fg}`}
                  >
                    {s.n}
                  </span>
                  <span className="font-bold text-sm leading-snug text-ink">{s.text}</span>
                </div>
              ))}
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              setStarted(true);
              trackQuizEvent({ name: "quiz_started" }, analyticsCtx);
            }}
            className="mt-[22px] w-full rounded-2xl border-[2.5px] border-ink bg-correct py-[18px] font-display text-[19px] font-bold text-white shadow-[5px_5px_0_#1b1813] transition active:translate-x-0.5 active:translate-y-0.5 active:shadow-none"
          >
            Play today&apos;s quiz →
          </button>

          {isDaily ? (
            <div className="mt-3.5 text-center font-bold text-xs text-muted">{formatLongDate(dateStr)}</div>
          ) : (
            <button
              type="button"
              onClick={loadNewQuiz}
              className="mt-3.5 block w-full text-center font-bold text-xs text-muted hover:underline"
            >
              ↻ Try another random quiz
            </button>
          )}
        </div>
      </main>
    );
  }

  // ── Progress tracker (shared by quiz + summary) ───────────────────────────
  const tracker = (
    <div className="flex gap-2">
      {players.map((p, i) => {
        const e = entries[i];
        const done = e.guessedCode != null;
        const isCurrent = i === currentIndex && !finished;
        const guessedFlag = countryByCode.get(e.guessedCode ?? "")?.flag ?? "🏳️";
        let cls = "bg-locked text-white"; // locked / upcoming
        if (done) {
          // Match the share grid: 🟩 correct no-hint · 🟨 correct with hint · 🟥 missed
          const tone = !e.correct ? "bg-wrong" : e.hints.length === 0 ? "bg-correct" : "bg-hint";
          cls = `${tone} shadow-[3px_3px_0_#1b1813]`;
        } else if (isCurrent) cls = "bg-active text-white shadow-[3px_3px_0_#1b1813]";
        return (
          <div
            key={i}
            className={`grid aspect-square flex-1 place-items-center rounded-xl border-[2.5px] border-ink font-display text-base font-bold ${cls}`}
          >
            {done ? <span className="text-4xl leading-none">{guessedFlag}</span> : i + 1}
          </div>
        );
      })}
    </div>
  );

  // ── Score summary ──────────────────────────────────────────────────────
  if (finished) {
    return (
      <main className="flex w-full flex-1 flex-col">
        <div className={`w-full ${cardShell} px-[18px] pb-[30px] pt-[26px]`}>
          <Logo />

          <div className="mt-6 mb-3 text-center font-extrabold text-[11px] uppercase tracking-[1.5px] text-muted">
            Your picks
          </div>
          {tracker}

          <div className="animate-pop mt-[18px] -rotate-1 rounded-[22px] bg-ink p-6 text-center shadow-[6px_6px_0_#ffd23f]">
            <div className="font-extrabold text-[11px] uppercase tracking-[1.6px] text-[#9a8f78]">
              Today&apos;s score
            </div>
            <div className="mt-1.5 font-display text-[56px] font-bold leading-none text-white">
              {score}
              <span className="text-[30px] text-[#7a715e]">/{maxScore}</span>
            </div>
            <div className="mt-2.5 inline-block rounded-full border-2 border-black bg-hint px-3.5 py-2 font-extrabold text-[13px] text-ink">
              {correctCount}/{n} correct
            </div>
          </div>

          <div className="mt-[18px] flex gap-2.5">
            <button
              type="button"
              onClick={handleShare}
              aria-label="Share result"
              className="relative grid shrink-0 place-items-center overflow-hidden rounded-[14px] border-[2.5px] border-ink bg-active px-[15px] py-3.5 text-white shadow-[3px_3px_0_#1b1813] transition active:translate-x-0.5 active:translate-y-0.5 active:shadow-none"
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <circle cx="18" cy="5" r="3" />
                <circle cx="6" cy="12" r="3" />
                <circle cx="18" cy="19" r="3" />
                <line x1="8.6" y1="10.5" x2="15.4" y2="6.5" />
                <line x1="8.6" y1="13.5" x2="15.4" y2="17.5" />
              </svg>
              {shareStatus === "copied" && (
                <span className="absolute inset-0 grid place-items-center bg-correct-ink font-display text-[13px] font-bold text-white">
                  ✓
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={handleShareToX}
              aria-label="Share on X"
              className="flex flex-1 items-center justify-center gap-2 rounded-[14px] border-[2.5px] border-ink bg-ink py-3.5 font-display text-[15px] font-bold text-white shadow-[3px_3px_0_#1b1813] transition active:translate-x-0.5 active:translate-y-0.5 active:shadow-none"
            >
              <span className="text-[17px] leading-none">𝕏</span>
              Share to X
            </button>
            <button
              type="button"
              onClick={handleShareToWhatsApp}
              aria-label="Share on WhatsApp"
              className="flex shrink-0 items-center gap-2 rounded-[14px] border-[2.5px] border-ink bg-hint px-[15px] py-3.5 font-display text-[15px] font-bold text-ink shadow-[3px_3px_0_#1b1813] transition active:translate-x-0.5 active:translate-y-0.5 active:shadow-none"
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.9 9.9 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2Zm0 1.84c2.16 0 4.18.84 5.7 2.37a8.02 8.02 0 0 1 2.37 5.7c0 4.45-3.62 8.07-8.08 8.07a8.1 8.1 0 0 1-4.13-1.13l-.3-.18-3.12.82.83-3.04-.19-.31a8.04 8.04 0 0 1-1.24-4.3c.01-4.45 3.63-8.07 8.16-8.07Zm-2.7 4.4c-.13 0-.34.05-.52.24-.18.2-.69.68-.69 1.65s.71 1.92.81 2.05c.1.13 1.39 2.12 3.37 2.97.47.2.84.32 1.12.42.47.15.9.13 1.24.08.38-.06 1.16-.47 1.33-.93.16-.46.16-.85.11-.93-.05-.08-.18-.13-.38-.23-.2-.1-1.16-.57-1.34-.64-.18-.06-.31-.1-.44.1-.13.2-.5.64-.62.77-.11.13-.23.15-.42.05-.2-.1-.83-.31-1.59-.98-.59-.52-.98-1.17-1.1-1.37-.11-.2-.01-.3.09-.4.09-.09.2-.23.3-.35.1-.12.13-.2.2-.34.06-.13.03-.25-.02-.35-.05-.1-.44-1.08-.62-1.48-.16-.38-.32-.33-.44-.34l-.38-.01Z" />
              </svg>
              WhatsApp
            </button>
          </div>

          <div className="mt-[22px] flex flex-col gap-2.5">
            {players.map((p, i) => {
              const e = entries[i];
              const answer = countryByCode.get(p.countryCode);
              const points = entryPoints(e);
              return (
                <div
                  key={p.id}
                  className="flex items-center gap-3 rounded-[14px] border-[2.5px] border-ink bg-surface px-3.5 py-3 shadow-[3px_3px_0_#1b1813]"
                >
                  <span
                    className={`grid size-[26px] shrink-0 place-items-center rounded-[7px] border-2 border-ink font-extrabold text-[13px] text-white ${
                      e.correct ? "bg-correct" : "bg-wrong"
                    }`}
                  >
                    {e.correct ? "✓" : "✕"}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-bold text-sm text-ink">
                    {p.name}
                  </span>
                  <span className="font-bold text-[13px] text-[#6b6457]">
                    {answer?.flag}{" "}
                    <span className={e.correct ? undefined : "font-extrabold text-correct-ink"}>
                      {answer?.name}
                    </span>
                  </span>
                  <span
                    className={`shrink-0 text-right font-extrabold text-[13px] tabular-nums ${
                      points > 0 ? "text-correct-ink" : "text-[#a89a7d]"
                    }`}
                  >
                    +{points}
                  </span>
                </div>
              );
            })}
          </div>

          <button
            type="button"
            onClick={openStats}
            className="mt-[22px] flex w-full items-center justify-center gap-2 rounded-[14px] border-[2.5px] border-ink bg-surface py-3.5 font-display text-[15px] font-bold text-ink shadow-[4px_4px_0_#1b1813] transition active:translate-x-0.5 active:translate-y-0.5 active:shadow-none"
          >
            📊 Statistics
          </button>

          <div className="mt-3 rounded-2xl border-[2.5px] border-ink bg-surface p-[18px] text-center font-mono font-bold text-sm leading-[1.7] text-ink shadow-[4px_4px_0_#1b1813]">
            <div>
              Daily Player ⚽ — {correctCount}/{n}
            </div>
            <div className="my-1.5 text-base leading-relaxed">
              {buildShareGrid(entries)}
            </div>
            <div className="text-[#a89a7d]">
              Come back tomorrow for {n} new players
            </div>
          </div>

          {!isDaily && (
            <button
              type="button"
              onClick={loadNewQuiz}
              className="mt-4 block w-full text-center font-bold text-xs text-muted hover:underline"
            >
              ↻ Try another random quiz
            </button>
          )}
        </div>

        {stats && (
          <StatsModal
            stats={stats}
            streak={streak}
            todayCorrect={isDaily ? correctCount : null}
            dailyAvgs={dailyAvgs}
            onClose={() => {
              setStats(null);
              setDailyAvgs(null);
            }}
          />
        )}
      </main>
    );
  }

  // ── Active question (current + currentEntry are non-null here) ─────────────
  const answerCountry = current ? countryByCode.get(current.countryCode) : null;
  // The name is itself a hint: keep it hidden until bought, then reveal it once
  // the player has been answered so the result is readable.
  const nameRevealed = !!currentEntry && (currentEntry.hints.includes("name") || answered);

  // Text shown once a hint is revealed for the current player.
  function hintText(key: HintKey): string {
    switch (key) {
      case "continent":
        return `🌍 Their national team is in ${continentOf(current!.countryCode) ?? "another region"}`;
      case "fact":
        return `🧩 ${factOf(current!.countryCode) ?? "No clue available for this one."}`;
      case "club":
        return `🏟️ Plays his club football for ${current!.club}`;
      case "name":
        return `🕵️ This player is ${current!.name}`;
    }
  }

  return (
    <main className="flex w-full flex-1 flex-col">
      <div className={`w-full ${cardShell} px-[18px] pb-[30px] pt-[26px]`}>
        <Logo />

        <div className="mt-6 mb-2.5 flex items-baseline justify-between">
          <span className="font-extrabold text-[11px] uppercase tracking-[1.4px] text-muted">
            Player {currentIndex + 1} of {n}
          </span>
          <span className="font-extrabold text-[13px] text-ink">
            {score}
            <span className="text-[#a89a7d]">/{maxScore} pts</span>
          </span>
        </div>

        {tracker}

        <div className="mt-[22px] rounded-[22px] border-[2.5px] border-ink bg-surface px-[22px] pb-6 pt-[26px] shadow-[6px_6px_0_#1b1813]">
          <div className="relative mx-auto size-[118px] overflow-hidden rounded-[22px] border-[2.5px] border-ink bg-base shadow-[4px_4px_0_#1b1813]">
            {current && (
              <Image
                src={current.photoUrl}
                alt={nameRevealed ? current.name : "Name hidden"}
                fill
                sizes="118px"
                className="object-cover"
                unoptimized
              />
            )}
          </div>

          <div className="mt-[18px] flex items-center justify-center gap-2.5">
            <span
              className={`font-display text-[25px] font-bold leading-tight ${
                nameRevealed ? "text-ink" : "text-muted"
              }`}
            >
              {nameRevealed ? current?.name : "Name Hidden"}
            </span>
          </div>

          {/* Revealed hints, newest last (in the order they were spent) */}
          {currentEntry && currentEntry.hints.some((k) => k !== "name") && (
            <div className="mt-4 space-y-2">
              {currentEntry.hints
                .filter((key) => key !== "name")
                .map((key) => (
                <div
                  key={key}
                  className="animate-slidein rounded-[14px] border-[2.5px] border-ink bg-hint px-3.5 py-3 text-center font-bold text-[13px] leading-snug text-ink"
                >
                  {hintText(key)}
                </div>
              ))}
            </div>
          )}

          {answered && currentEntry ? (
            <>
              <div
                className={`mt-[18px] rounded-2xl border-[2.5px] border-ink p-4 ${
                  currentEntry.correct ? "bg-correct-soft" : "bg-wrong-soft"
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <span className="text-2xl">{currentEntry.correct ? "✅" : "❌"}</span>
                  <span className="font-display text-base font-bold text-ink">
                    {currentEntry.correct ? "Correct!" : "Not quite"}
                  </span>
                  <span className="ml-auto font-extrabold text-sm text-ink">
                    +{entryPoints(currentEntry)}
                  </span>
                </div>
                <div className="mt-2 font-bold text-sm leading-snug text-ink">
                  {currentEntry.correct ? (
                    <>
                      It&apos;s {answerCountry?.name} {answerCountry?.flag}
                    </>
                  ) : (
                    <>
                      You said “
                      {countryByCode.get(currentEntry.guessedCode!)?.name ?? "—"}” — it was{" "}
                      {answerCountry?.name} {answerCountry?.flag}
                    </>
                  )}
                </div>
              </div>

              <button
                type="button"
                onClick={nextPlayer}
                className="mt-3.5 w-full rounded-[14px] border-[2.5px] border-ink bg-active py-3.5 text-center font-display text-base font-bold text-white shadow-[4px_4px_0_#1b1813] transition active:translate-x-0.5 active:translate-y-0.5 active:shadow-none"
              >
                {currentIndex + 1 < n ? "Next player →" : "See results →"}
              </button>
            </>
          ) : (
            <>
              {currentEntry && HINTS.some((h) => !currentEntry.hints.includes(h.key)) && (
                <div className="mt-4 flex flex-wrap justify-center gap-2">
                  {HINTS.filter((h) => !currentEntry.hints.includes(h.key)).map((h) => (
                    <button
                      key={h.key}
                      type="button"
                      onClick={() => revealHint(h.key)}
                      className="inline-flex items-center gap-1.5 rounded-full border-[2.5px] border-ink bg-hint px-[18px] py-2.5 font-extrabold text-[13px] text-ink shadow-[3px_3px_0_#1b1813] transition active:translate-x-0.5 active:translate-y-0.5 active:shadow-none"
                    >
                      {h.emoji} {h.label} <span className="text-muted">−{h.cost}</span>
                    </button>
                  ))}
                </div>
              )}

              <div className="mt-[18px]">
                <CountryTypeahead countries={countries} onSelect={handleGuess} />
              </div>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
