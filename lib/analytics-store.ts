import "server-only";
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

// ── Event vocabulary (shared shape between client, API and store) ──────────
export const ANALYTICS_EVENT_NAMES = [
  "quiz_started",
  "hint_revealed",
  "quiz_completed",
  "share_result",
  "share_x",
  "share_whatsapp",
] as const;

export type AnalyticsEventName = (typeof ANALYTICS_EVENT_NAMES)[number];

export const HINT_KEYS = ["continent", "fact", "club", "name"] as const;
export type HintKey = (typeof HINT_KEYS)[number];

/** A validated event ready to persist. Optional columns apply only to some events. */
export type AnalyticsEventInput = {
  eventName: AnalyticsEventName;
  userId: string;
  puzzleNumber: number | null;
  seed: string | null;
  isDailyQuiz: boolean;
  playerIndex?: number | null; // hint_revealed
  hintKey?: HintKey | null; // hint_revealed
  score?: number | null; // quiz_completed
  maxScore?: number | null; // quiz_completed
  correctCount?: number | null; // quiz_completed
};

/** A raw row as returned to the admin dashboard. */
export type AnalyticsEventRow = {
  id: number;
  eventName: string;
  userId: string;
  puzzleNumber: number | null;
  seed: string | null;
  isDailyQuiz: boolean;
  playerIndex: number | null;
  hintKey: string | null;
  score: number | null;
  maxScore: number | null;
  correctCount: number | null;
  createdAt: string;
};

export type QuizTypeFilter = "all" | "daily" | "random";

/** Filters accepted by both the raw-event and summary read paths. */
export type AnalyticsFilters = {
  from?: string | null; // ISO datetime, inclusive
  to?: string | null; // ISO datetime, inclusive
  quizType?: QuizTypeFilter;
  puzzleNumber?: number | null;
  eventName?: AnalyticsEventName | null;
  limit?: number;
};

export type AnalyticsSummary = {
  totalEvents: number;
  uniqueUsers: number;
  byEvent: Record<AnalyticsEventName, number>;
  completion: {
    plays: number; // quiz_completed count
    avgScore: number | null;
    avgCorrect: number | null;
    completionRate: number | null; // completed / started
  };
  hintsByKey: Record<HintKey, number>;
};

// ── Connection ────────────────────────────────────────────────────────────
let cached: NeonQueryFunction<false, false> | null = null;

/** Lazily build the Neon client so missing config fails loudly only when used. */
function getSql(): NeonQueryFunction<false, false> {
  if (cached) return cached;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set — cannot reach the analytics store.");
  }
  cached = neon(url);
  return cached;
}

// ── Filter → SQL ──────────────────────────────────────────────────────────
/** Build a parameterised WHERE clause shared by the read queries. */
function buildWhere(filters: AnalyticsFilters): { clause: string; params: unknown[] } {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters.from) {
    params.push(filters.from);
    conditions.push(`created_at >= $${params.length}`);
  }
  if (filters.to) {
    params.push(filters.to);
    conditions.push(`created_at <= $${params.length}`);
  }
  if (filters.quizType === "daily") conditions.push("is_daily_quiz = TRUE");
  if (filters.quizType === "random") conditions.push("is_daily_quiz = FALSE");
  if (filters.puzzleNumber != null) {
    params.push(filters.puzzleNumber);
    conditions.push(`puzzle_number = $${params.length}`);
  }
  if (filters.eventName) {
    params.push(filters.eventName);
    conditions.push(`event_name = $${params.length}`);
  }

  const clause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  return { clause, params };
}

// ── Writes ──────────────────────────────────────────────────────────────
/** Persist a single validated event. */
export async function appendEvent(event: AnalyticsEventInput): Promise<void> {
  const sql = getSql();
  await sql.query(
    `INSERT INTO analytics_events
       (event_name, user_id, puzzle_number, seed, is_daily_quiz,
        player_index, hint_key, score, max_score, correct_count)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      event.eventName,
      event.userId,
      event.puzzleNumber,
      event.seed,
      event.isDailyQuiz,
      event.playerIndex ?? null,
      event.hintKey ?? null,
      event.score ?? null,
      event.maxScore ?? null,
      event.correctCount ?? null,
    ]
  );
}

// ── Reads ──────────────────────────────────────────────────────────────
const MAX_ROWS = 1000;

/** Community average score for a daily puzzle, across every player who finished it. */
export type DailyAverage = { puzzleNumber: number; avgScore: number; plays: number };

/**
 * Average completed-quiz score per daily puzzle, for the given puzzle numbers.
 * Returns a map keyed by puzzle number; days with no plays are simply absent.
 */
export async function getDailyAverageScores(
  puzzleNumbers: number[]
): Promise<Map<number, DailyAverage>> {
  const result = new Map<number, DailyAverage>();
  if (puzzleNumbers.length === 0) return result;

  const sql = getSql();
  const placeholders = puzzleNumbers.map((_, i) => `$${i + 1}`).join(", ");
  const rows = (await sql.query(
    `SELECT puzzle_number,
            AVG(score)::float AS avg_score,
            COUNT(*)::int AS plays
       FROM analytics_events
       WHERE event_name = 'quiz_completed'
         AND is_daily_quiz = TRUE
         AND score IS NOT NULL
         AND puzzle_number IN (${placeholders})
       GROUP BY puzzle_number`,
    puzzleNumbers
  )) as Record<string, unknown>[];

  for (const r of rows) {
    const puzzleNumber = Number(r.puzzle_number);
    result.set(puzzleNumber, {
      puzzleNumber,
      avgScore: Number(r.avg_score),
      plays: Number(r.plays),
    });
  }
  return result;
}

/** One UTC calendar day of bucketed engagement metrics, for the dashboard charts. */
export type DailyTimeSeriesRow = {
  day: string; // YYYY-MM-DD (UTC)
  uniqueUsers: number;
  started: number;
  completed: number;
  completionRate: number | null; // completed / started, null when nobody started
  shareResult: number;
  shareX: number;
  shareWhatsapp: number;
};

/**
 * Per-day engagement series for the filtered window, oldest → newest. Days with
 * no matching events are simply absent (the charts treat gaps as zero).
 */
export async function getDailyTimeSeries(
  filters: AnalyticsFilters
): Promise<DailyTimeSeriesRow[]> {
  const sql = getSql();
  const { clause, params } = buildWhere(filters);

  const rows = (await sql.query(
    `SELECT to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
            COUNT(DISTINCT user_id)::int AS unique_users,
            COUNT(*) FILTER (WHERE event_name = 'quiz_started')::int AS started,
            COUNT(*) FILTER (WHERE event_name = 'quiz_completed')::int AS completed,
            COUNT(*) FILTER (WHERE event_name = 'share_result')::int AS share_result,
            COUNT(*) FILTER (WHERE event_name = 'share_x')::int AS share_x,
            COUNT(*) FILTER (WHERE event_name = 'share_whatsapp')::int AS share_whatsapp
       FROM analytics_events
       ${clause}
       GROUP BY day
       ORDER BY day`,
    params
  )) as Record<string, unknown>[];

  return rows.map((r) => {
    const started = Number(r.started);
    const completed = Number(r.completed);
    return {
      day: String(r.day),
      uniqueUsers: Number(r.unique_users),
      started,
      completed,
      completionRate: started > 0 ? completed / started : null,
      shareResult: Number(r.share_result),
      shareX: Number(r.share_x),
      shareWhatsapp: Number(r.share_whatsapp),
    };
  });
}

/** Raw events matching the filters, newest first. */
export async function getEvents(filters: AnalyticsFilters): Promise<AnalyticsEventRow[]> {
  const sql = getSql();
  const { clause, params } = buildWhere(filters);
  const limit = Math.min(Math.max(filters.limit ?? 200, 1), MAX_ROWS);
  params.push(limit);

  const rows = (await sql.query(
    `SELECT id, event_name, user_id, puzzle_number, seed, is_daily_quiz,
            player_index, hint_key, score, max_score, correct_count, created_at
       FROM analytics_events
       ${clause}
       ORDER BY created_at DESC
       LIMIT $${params.length}`,
    params
  )) as Record<string, unknown>[];

  return rows.map((r) => ({
    id: Number(r.id),
    eventName: String(r.event_name),
    userId: String(r.user_id),
    puzzleNumber: r.puzzle_number == null ? null : Number(r.puzzle_number),
    seed: r.seed == null ? null : String(r.seed),
    isDailyQuiz: Boolean(r.is_daily_quiz),
    playerIndex: r.player_index == null ? null : Number(r.player_index),
    hintKey: r.hint_key == null ? null : String(r.hint_key),
    score: r.score == null ? null : Number(r.score),
    maxScore: r.max_score == null ? null : Number(r.max_score),
    correctCount: r.correct_count == null ? null : Number(r.correct_count),
    createdAt: new Date(r.created_at as string).toISOString(),
  }));
}

/** Aggregate counts and quiz-completion metrics for the filtered window. */
export async function getSummary(filters: AnalyticsFilters): Promise<AnalyticsSummary> {
  const sql = getSql();
  const { clause, params } = buildWhere(filters);

  const [perEvent, totals, completed, hints] = await Promise.all([
    sql.query(
      `SELECT event_name, COUNT(*)::int AS count
         FROM analytics_events ${clause}
         GROUP BY event_name`,
      params
    ) as Promise<Record<string, unknown>[]>,
    sql.query(
      `SELECT COUNT(*)::int AS total, COUNT(DISTINCT user_id)::int AS unique_users
         FROM analytics_events ${clause}`,
      params
    ) as Promise<Record<string, unknown>[]>,
    sql.query(
      `SELECT COUNT(*)::int AS plays,
              AVG(score)::float AS avg_score,
              AVG(correct_count)::float AS avg_correct
         FROM analytics_events
         ${clause ? `${clause} AND` : "WHERE"} event_name = 'quiz_completed'`,
      params
    ) as Promise<Record<string, unknown>[]>,
    sql.query(
      `SELECT hint_key, COUNT(*)::int AS count
         FROM analytics_events
         ${clause ? `${clause} AND` : "WHERE"} event_name = 'hint_revealed'
         GROUP BY hint_key`,
      params
    ) as Promise<Record<string, unknown>[]>,
  ]);

  const byEvent = Object.fromEntries(
    ANALYTICS_EVENT_NAMES.map((name) => [name, 0])
  ) as Record<AnalyticsEventName, number>;
  for (const row of perEvent) {
    const name = String(row.event_name) as AnalyticsEventName;
    if (name in byEvent) byEvent[name] = Number(row.count);
  }

  const hintsByKey = Object.fromEntries(HINT_KEYS.map((k) => [k, 0])) as Record<HintKey, number>;
  for (const row of hints) {
    const key = String(row.hint_key) as HintKey;
    if (key in hintsByKey) hintsByKey[key] = Number(row.count);
  }

  const plays = Number(completed[0]?.plays ?? 0);
  const started = byEvent.quiz_started;
  const avgScore = completed[0]?.avg_score == null ? null : Number(completed[0].avg_score);
  const avgCorrect = completed[0]?.avg_correct == null ? null : Number(completed[0].avg_correct);

  return {
    totalEvents: Number(totals[0]?.total ?? 0),
    uniqueUsers: Number(totals[0]?.unique_users ?? 0),
    byEvent,
    completion: {
      plays,
      avgScore,
      avgCorrect,
      completionRate: started > 0 ? plays / started : null,
    },
    hintsByKey,
  };
}
