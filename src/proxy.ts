import { NextResponse, type NextRequest } from "next/server";

import { middleware as updateSession } from "@/lib/supabase/middleware";

const devStdPayCsp =
  "default-src 'self'; " +
  "script-src 'self' 'unsafe-inline' https://stgstdpay.inicis.com https://stdpay.inicis.com https://stdux.inicis.com; " +
  "script-src-elem 'self' 'unsafe-inline' https://stgstdpay.inicis.com https://stdpay.inicis.com https://stdux.inicis.com; " +
  "frame-src 'self' https://stgstdpay.inicis.com https://stdpay.inicis.com; " +
  "style-src 'self' 'unsafe-inline' https://stgstdpay.inicis.com https://stdpay.inicis.com; " +
  "style-src-elem 'self' 'unsafe-inline' https://stgstdpay.inicis.com https://stdpay.inicis.com; " +
  "img-src 'self' data: https://stgstdpay.inicis.com https://stdux.inicis.com; " +
  "connect-src 'self' https://stgstdpay.inicis.com https://stdpay.inicis.com";

function withCookies(target: NextResponse, source: NextResponse) {
  source.cookies.getAll().forEach((cookie) => {
    target.cookies.set(cookie);
  });
  return target;
}

const supabaseAuthCookiePattern = /^sb-[a-z0-9]+-auth-token(?:\.\d+)?$/i;
const authCheckedCookieName = "glit_auth_checked_at";
const authCheckBypassTtlMs = 20_000;

function hasSupabaseAuthCookie(request: NextRequest) {
  return request.cookies
    .getAll()
    .some((cookie) => supabaseAuthCookiePattern.test(cookie.name));
}

function withAuthCheckedCookie(response: NextResponse) {
  response.cookies.set(authCheckedCookieName, String(Date.now()), {
    path: "/",
    maxAge: 60,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
  return response;
}

export default async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isDev = process.env.NODE_ENV !== "production";
  const isDevStdPayPath =
    pathname === "/dev/inicis-stdpay" ||
    pathname.startsWith("/api/dev/inicis/stdpay") ||
    pathname.startsWith("/api/dev/inicis/stdpay-return");
  const isAdminRoute = pathname.startsWith("/admin");
  const isDashboardRoute = pathname.startsWith("/dashboard");
  const isMypageRoute = pathname.startsWith("/mypage");
  const isPublicDashboardRoute = pathname.startsWith("/dashboard/new");
  const isUserProtectedRoute =
    (isDashboardRoute && !isPublicDashboardRoute) || isMypageRoute;
  const requiresSessionCookie =
    isUserProtectedRoute || isAdminRoute;

  if (!requiresSessionCookie) {
    const passthrough = NextResponse.next();
    if (isDev && isDevStdPayPath) {
      passthrough.headers.set("Content-Security-Policy", devStdPayCsp);
    }
    return passthrough;
  }

  if (!hasSupabaseAuthCookie(request)) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/login";
    redirectUrl.searchParams.set("next", pathname);
    const redirectRes = NextResponse.redirect(redirectUrl);
    if (isDev && isDevStdPayPath) {
      redirectRes.headers.set("Content-Security-Policy", devStdPayCsp);
    }
    return redirectRes;
  }

  const lastCheckedAt = Number(request.cookies.get(authCheckedCookieName)?.value ?? "");
  const isAuthCheckFresh =
    Number.isFinite(lastCheckedAt) && Date.now() - lastCheckedAt < authCheckBypassTtlMs;

  // Skip repeated auth round-trips during quick tab/page moves.
  if (isUserProtectedRoute && isAuthCheckFresh) {
    const passthrough = NextResponse.next();
    if (isDev && isDevStdPayPath) {
      passthrough.headers.set("Content-Security-Policy", devStdPayCsp);
    }
    return passthrough;
  }

  const session = await updateSession(request);
  const response =
    session instanceof NextResponse ? session : (session?.response as NextResponse | undefined);
  const user = session instanceof NextResponse ? null : session?.user ?? null;
  const supabase = session instanceof NextResponse ? null : session?.supabase ?? null;
  if (!response) {
    return NextResponse.next();
  }

  // Ensure submission detail carries ?id=<uuid> for downstream usage
  const submissionMatch = pathname.match(
    /^\/admin\/submissions\/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/,
  );
  if (submissionMatch && !request.nextUrl.searchParams.get("id")) {
    const url = request.nextUrl.clone();
    url.pathname = "/admin/submissions/detail";
    url.searchParams.set("id", submissionMatch[1]);
    const redirectRes = NextResponse.redirect(url);
    redirectRes.cookies.set("admin_submission_id", submissionMatch[1], {
      path: "/admin/submissions",
    });
    return withCookies(redirectRes, response);
  }
  if (submissionMatch && !response.cookies.get("admin_submission_id")) {
    response.cookies.set("admin_submission_id", submissionMatch[1], {
      path: "/admin/submissions",
    });
  }

  if (!user) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/login";
    redirectUrl.searchParams.set("next", pathname);
    const redirectRes = withCookies(NextResponse.redirect(redirectUrl), response);
    if (isDev && isDevStdPayPath) {
      redirectRes.headers.set("Content-Security-Policy", devStdPayCsp);
    }
    return redirectRes;
  }

  if (!isAdminRoute) {
    if (isDev && isDevStdPayPath) {
      response.headers.set("Content-Security-Policy", devStdPayCsp);
    }
    return withAuthCheckedCookie(response);
  }

  if (isAdminRoute && user) {
    if (supabase) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("user_id", user.id)
        .maybeSingle();

      if (!profile || profile.role !== "admin") {
        const redirectUrl = request.nextUrl.clone();
        redirectUrl.pathname = "/dashboard";
        const redirectRes = withCookies(NextResponse.redirect(redirectUrl), response);
        if (isDev && isDevStdPayPath) {
          redirectRes.headers.set("Content-Security-Policy", devStdPayCsp);
        }
        return redirectRes;
      }
    } else {
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = "/dashboard";
      const redirectRes = withCookies(NextResponse.redirect(redirectUrl), response);
      if (isDev && isDevStdPayPath) {
        redirectRes.headers.set("Content-Security-Policy", devStdPayCsp);
      }
      return redirectRes;
    }
  }

  if (isDev && isDevStdPayPath) {
    response.headers.set("Content-Security-Policy", devStdPayCsp);
  }

  return withAuthCheckedCookie(response);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
