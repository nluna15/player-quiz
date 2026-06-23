// Single-secret auth for every analytics read path. Intentionally free of
// framework imports so it can run in route handlers AND middleware.

export const ANALYTICS_COOKIE = "analytics_auth";
/** 7 days, matching the login cookie lifetime. */
export const ANALYTICS_COOKIE_MAX_AGE = 60 * 60 * 24 * 7;

/** Length-aware constant-time string compare to avoid leaking the token. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

function getReadToken(): string | null {
  return process.env.ANALYTICS_READ_TOKEN || null;
}

/** True when `candidate` matches the configured read token. */
export function tokenMatches(candidate: string | null | undefined): boolean {
  const token = getReadToken();
  if (!token || !candidate) return false;
  return safeEqual(candidate, token);
}

/** Read a single cookie value straight off the request (no next/headers). */
export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return null;
}

/** Authorize a read request via `Authorization: Bearer` or the auth cookie. */
export function requireReadAuth(request: Request): boolean {
  const header = request.headers.get("authorization");
  if (header && header.startsWith("Bearer ") && tokenMatches(header.slice(7).trim())) {
    return true;
  }
  return tokenMatches(readCookie(request, ANALYTICS_COOKIE));
}
