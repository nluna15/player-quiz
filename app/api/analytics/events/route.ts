import { NextResponse } from "next/server";
import {
  ANALYTICS_EVENT_NAMES,
  HINT_KEYS,
  appendEvent,
  getEvents,
  type AnalyticsEventInput,
  type AnalyticsEventName,
  type HintKey,
} from "@/lib/analytics-store";
import { requireReadAuth } from "@/lib/analytics-auth";
import { parseFilters } from "@/lib/analytics-filters";

// Persisting to Neon needs the Node.js runtime (not edge).
export const runtime = "nodejs";

const EVENT_NAMES = new Set<string>(ANALYTICS_EVENT_NAMES);
const HINT_SET = new Set<string>(HINT_KEYS);

/** Coerce an unknown into a finite integer, or null when absent/invalid. */
function toInt(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.trunc(value);
}

// ── Naive in-memory rate limit (per userId) ────────────────────────────────
// Best-effort only: bounds abuse from a single client within one warm instance.
const RATE_LIMIT = 60; // events
const RATE_WINDOW_MS = 60_000; // per minute
const hits = new Map<string, { count: number; resetAt: number }>();

function rateLimited(userId: string): boolean {
  const now = Date.now();
  const entry = hits.get(userId);
  if (!entry || now > entry.resetAt) {
    hits.set(userId, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > RATE_LIMIT;
}

/** Validate the raw POST body into a persistable event, or return an error string. */
function validate(body: unknown): { event: AnalyticsEventInput } | { error: string } {
  if (typeof body !== "object" || body === null) return { error: "Body must be an object." };
  const b = body as Record<string, unknown>;

  const eventName = b.eventName;
  if (typeof eventName !== "string" || !EVENT_NAMES.has(eventName)) {
    return { error: "Unknown or missing eventName." };
  }
  const userId = b.userId;
  if (typeof userId !== "string" || userId.length === 0 || userId.length > 100) {
    return { error: "Missing or invalid userId." };
  }

  const seed = typeof b.seed === "string" ? b.seed.slice(0, 100) : null;
  const isDailyQuiz = b.isDailyQuiz === true;
  const puzzleNumber = toInt(b.puzzleNumber);

  const event: AnalyticsEventInput = {
    eventName: eventName as AnalyticsEventName,
    userId,
    puzzleNumber,
    seed,
    isDailyQuiz,
  };

  // Event-specific payload, only persisted for the events that carry it.
  if (eventName === "hint_revealed") {
    const hintKey = b.hintKey;
    if (typeof hintKey !== "string" || !HINT_SET.has(hintKey)) {
      return { error: "hint_revealed requires a valid hintKey." };
    }
    event.hintKey = hintKey as HintKey;
    event.playerIndex = toInt(b.playerIndex);
  } else if (eventName === "quiz_completed") {
    event.score = toInt(b.score);
    event.maxScore = toInt(b.maxScore);
    event.correctCount = toInt(b.correctCount);
  }

  return { event };
}

/** Public ingest: anyone may record an event (fire-and-forget from the client). */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const result = validate(body);
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  if (rateLimited(result.event.userId)) {
    return NextResponse.json({ error: "Too many events." }, { status: 429 });
  }

  try {
    await appendEvent(result.event);
  } catch (err) {
    console.error("Failed to persist analytics event:", err);
    return NextResponse.json({ error: "Storage error." }, { status: 500 });
  }

  return NextResponse.json({ ok: true }, { status: 202 });
}

/** Private read: filtered raw events. Requires the analytics read token. */
export async function GET(request: Request) {
  if (!requireReadAuth(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const filters = parseFilters(new URL(request.url).searchParams);
  try {
    const events = await getEvents(filters);
    return NextResponse.json({ events });
  } catch (err) {
    console.error("Failed to read analytics events:", err);
    return NextResponse.json({ error: "Storage error." }, { status: 500 });
  }
}
