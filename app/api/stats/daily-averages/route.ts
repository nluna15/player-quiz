import { NextResponse } from "next/server";
import { getDailyAverageScores } from "@/lib/analytics-store";
import { getPuzzleNumber, getTodayDateString } from "@/lib/quiz";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** How many recent daily puzzles the comparison chart shows (today included). */
const DAYS = 5;

/** A single day in the public comparison chart. */
type DailyAverageResponse = {
  date: string; // YYYY-MM-DD
  puzzleNumber: number;
  avgScore: number | null; // null when nobody has finished that day yet
  plays: number;
};

/**
 * Public read: community average score for the last {@link DAYS} daily puzzles,
 * ending today. Aggregate-only (no user-level data), so it needs no auth — it
 * powers the "you vs. everyone" chart in the Statistics modal.
 */
export async function GET() {
  const today = getTodayDateString();

  // The last DAYS calendar days ending today, oldest → newest. Days before the
  // game launched (puzzle number < 1) are dropped rather than shown empty.
  const entries: { date: string; puzzleNumber: number }[] = [];
  for (let i = DAYS - 1; i >= 0; i--) {
    const d = new Date(`${today}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - i);
    const date = d.toISOString().slice(0, 10);
    const puzzleNumber = getPuzzleNumber(date);
    if (puzzleNumber >= 1) entries.push({ date, puzzleNumber });
  }

  try {
    const averages = await getDailyAverageScores(entries.map((e) => e.puzzleNumber));
    const days: DailyAverageResponse[] = entries.map((e) => {
      const avg = averages.get(e.puzzleNumber);
      return {
        date: e.date,
        puzzleNumber: e.puzzleNumber,
        avgScore: avg ? Math.round(avg.avgScore) : null,
        plays: avg ? avg.plays : 0,
      };
    });
    return NextResponse.json({ days });
  } catch (err) {
    console.error("Failed to read daily average scores:", err);
    // Best-effort: the chart hides itself rather than breaking the modal.
    return NextResponse.json({ days: [] });
  }
}
