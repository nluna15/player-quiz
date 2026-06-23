import {
  ANALYTICS_EVENT_NAMES,
  type AnalyticsEventName,
  type AnalyticsFilters,
  type QuizTypeFilter,
} from "@/lib/analytics-store";

const EVENT_NAMES = new Set<string>(ANALYTICS_EVENT_NAMES);
const QUIZ_TYPES = new Set<QuizTypeFilter>(["all", "daily", "random"]);

/** Parse admin-dashboard query params into validated store filters. */
export function parseFilters(params: URLSearchParams): AnalyticsFilters {
  const from = params.get("from");
  const to = params.get("to");

  const quizTypeRaw = params.get("quizType");
  const quizType: QuizTypeFilter =
    quizTypeRaw && QUIZ_TYPES.has(quizTypeRaw as QuizTypeFilter)
      ? (quizTypeRaw as QuizTypeFilter)
      : "all";

  const puzzleRaw = params.get("puzzleNumber");
  const puzzleNumber = puzzleRaw && /^\d+$/.test(puzzleRaw) ? Number(puzzleRaw) : null;

  const eventRaw = params.get("eventName");
  const eventName =
    eventRaw && EVENT_NAMES.has(eventRaw) ? (eventRaw as AnalyticsEventName) : null;

  const limitRaw = params.get("limit");
  const limit = limitRaw && /^\d+$/.test(limitRaw) ? Number(limitRaw) : undefined;

  return {
    from: from || null,
    to: to || null,
    quizType,
    puzzleNumber,
    eventName,
    limit,
  };
}
