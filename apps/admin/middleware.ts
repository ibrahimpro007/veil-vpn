import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * First-pass route guard for /dashboard/*.
 *
 * The login page sets a `veil_admin_auth=1` marker cookie (client-side,
 * session-scoped). This middleware redirects to /login when the marker is
 * absent so logged-out visitors never flash protected UI.
 *
 * SECURITY NOTE: this marker is NOT a security boundary — it is a UX
 * nicety. Real enforcement happens at the Worker API: every /admin/* call
 * requires the admin session JWT (Authorization: Bearer), and the API
 * answers 401/403 for missing, expired, or under-privileged tokens. The
 * frontend treats any 401 as "signed out" and redirects to /login.
 */
export function middleware(req: NextRequest) {
  const marker = req.cookies.get("veil_admin_auth")?.value;
  if (!marker) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", req.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*"],
};
