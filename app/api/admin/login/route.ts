import { NextResponse } from "next/server";
import {
  ANALYTICS_COOKIE,
  ANALYTICS_COOKIE_MAX_AGE,
  tokenMatches,
} from "@/lib/analytics-auth";

export const runtime = "nodejs";

/** Exchange the analytics token for a 7-day httpOnly session cookie. */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const token = (body as Record<string, unknown> | null)?.token;
  if (typeof token !== "string" || !tokenMatches(token)) {
    return NextResponse.json({ error: "Invalid token." }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(ANALYTICS_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: ANALYTICS_COOKIE_MAX_AGE,
    path: "/",
  });
  return response;
}

/** Clear the session cookie (sign out). */
export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(ANALYTICS_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 0,
    path: "/",
  });
  return response;
}
