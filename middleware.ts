import { NextResponse, type NextRequest } from "next/server";
import { ANALYTICS_COOKIE, tokenMatches } from "@/lib/analytics-auth";

/** Gate every /admin route behind the analytics token, except the login page. */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname === "/admin/login") return NextResponse.next();

  if (tokenMatches(request.cookies.get(ANALYTICS_COOKIE)?.value)) {
    return NextResponse.next();
  }

  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = "/admin/login";
  loginUrl.search = "";
  loginUrl.searchParams.set("next", pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/admin", "/admin/:path*"],
};
