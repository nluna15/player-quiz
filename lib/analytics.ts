// Client-side analytics helper. Sends fire-and-forget events to the public
// ingest API; never throws into the UI. Event shapes mirror lib/analytics-store.ts
// (kept local so this file stays free of the server-only store import).

const USER_ID_KEY = "quiz-anonymous-id";

/** A trackable event plus its event-specific payload. */
export type TrackableEvent =
  | { name: "quiz_started" }
  | {
      name: "hint_revealed";
      playerIndex: number;
      hintKey: "continent" | "fact" | "club" | "name";
    }
  | { name: "quiz_completed"; score: number; maxScore: number; correctCount: number }
  | { name: "share_result" }
  | { name: "share_x" }
  | { name: "share_whatsapp" };

/** Context shared by every event for the current quiz. */
export type QuizAnalyticsContext = {
  puzzleNumber: number;
  seed: string;
  isDailyQuiz: boolean;
};

/** Stable anonymous id for this browser, created lazily in localStorage. */
export function getAnonymousUserId(): string {
  if (typeof window === "undefined") return "server";
  try {
    let id = localStorage.getItem(USER_ID_KEY);
    if (!id) {
      id =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      localStorage.setItem(USER_ID_KEY, id);
    }
    return id;
  } catch {
    // Privacy mode / disabled storage — fall back to a non-persistent id.
    return "anonymous";
  }
}

/** Best-effort POST of a single event. Silently ignores all failures. */
export function trackQuizEvent(event: TrackableEvent, context: QuizAnalyticsContext): void {
  if (typeof window === "undefined") return;
  const { name, ...payload } = event;
  const body = JSON.stringify({
    eventName: name,
    userId: getAnonymousUserId(),
    puzzleNumber: context.puzzleNumber,
    seed: context.seed,
    isDailyQuiz: context.isDailyQuiz,
    ...payload,
  });
  try {
    // keepalive lets the request survive a page unload (e.g. share navigations).
    void fetch("/api/analytics/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Ignore — analytics must never break gameplay.
  }
}
