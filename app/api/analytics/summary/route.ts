import { NextResponse } from "next/server";
import { getSummary } from "@/lib/analytics-store";
import { requireReadAuth } from "@/lib/analytics-auth";
import { parseFilters } from "@/lib/analytics-filters";

export const runtime = "nodejs";

/** Private read: aggregate engagement metrics. Requires the analytics read token. */
export async function GET(request: Request) {
  if (!requireReadAuth(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const filters = parseFilters(new URL(request.url).searchParams);
  try {
    const summary = await getSummary(filters);
    return NextResponse.json({ summary });
  } catch (err) {
    console.error("Failed to read analytics summary:", err);
    return NextResponse.json({ error: "Storage error." }, { status: 500 });
  }
}
