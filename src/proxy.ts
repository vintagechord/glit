import { NextResponse, type NextRequest } from "next/server";

import { PAYMENT_RESULT_GRANT_COOKIE } from "@/lib/payment-result-grant-cookie";
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
const adminSubmissionCookieOptions = {
  path: "/admin/submissions",
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  maxAge: 60 * 60,
};

function hasSupabaseAuthCookie(request: NextRequest) {
  return request.cookies
    .getAll()
    .some((cookie) => supabaseAuthCookiePattern.test(cookie.name));
}

export default async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isEnglishRoute = pathname === "/en" || pathname.startsWith("/en/");
  const authPathname =
    isEnglishRoute && pathname !== "/en"
      ? pathname.replace(/^\/en(?=\/)/, "")
      : pathname;
  const isDev = process.env.NODE_ENV !== "production";
  const isDevStdPayPath =
    pathname === "/dev/inicis-stdpay" ||
    pathname.startsWith("/api/dev/inicis/stdpay") ||
    pathname.startsWith("/api/dev/inicis/stdpay-return");
  const isAdminRoute = authPathname.startsWith("/admin");
  const isDashboardRoute = authPathname.startsWith("/dashboard");
  const isMypageRoute = authPathname.startsWith("/mypage");
  const isPublicCartRoute =
    authPathname === "/mypage/cart" || authPathname === "/dashboard/cart";
  const isSubmissionDetailRoute =
    /^\/dashboard\/submissions\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      authPathname,
    );
  // Cookie presence only bypasses the session redirect. The server page
  // decrypts it and checks the exact submission + DB guest token before any
  // submission data is rendered.
  const hasPaymentResultGrant = Boolean(
    request.cookies.get(PAYMENT_RESULT_GRANT_COOKIE)?.value,
  );
  const isPublicDashboardRoute =
    authPathname.startsWith("/dashboard/new") ||
    isPublicCartRoute ||
    (isSubmissionDetailRoute && hasPaymentResultGrant);
  const isUserProtectedRoute =
    (isDashboardRoute && !isPublicDashboardRoute) ||
    (isMypageRoute && !isPublicCartRoute);
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
    const nextPath = `${pathname}${request.nextUrl.search}`;
    redirectUrl.pathname = isEnglishRoute ? "/en/login" : "/login";
    redirectUrl.search = "";
    redirectUrl.searchParams.set("next", nextPath);
    const redirectRes = NextResponse.redirect(redirectUrl);
    if (isDev && isDevStdPayPath) {
      redirectRes.headers.set("Content-Security-Policy", devStdPayCsp);
    }
    return redirectRes;
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
      ...adminSubmissionCookieOptions,
    });
    return withCookies(redirectRes, response);
  }
  if (submissionMatch && !response.cookies.get("admin_submission_id")) {
    response.cookies.set("admin_submission_id", submissionMatch[1], {
      ...adminSubmissionCookieOptions,
    });
  }

  if (!user) {
    const redirectUrl = request.nextUrl.clone();
    const nextPath = `${pathname}${request.nextUrl.search}`;
    redirectUrl.pathname = isEnglishRoute ? "/en/login" : "/login";
    redirectUrl.searchParams.set("next", nextPath);
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
    return response;
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
        redirectUrl.pathname = isEnglishRoute ? "/en/dashboard" : "/dashboard";
        const redirectRes = withCookies(NextResponse.redirect(redirectUrl), response);
        if (isDev && isDevStdPayPath) {
          redirectRes.headers.set("Content-Security-Policy", devStdPayCsp);
        }
        return redirectRes;
      }
    } else {
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = isEnglishRoute ? "/en/dashboard" : "/dashboard";
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

  return response;
}

export const config = {
  matcher: [
    "/admin/:path*",
    "/dashboard/:path*",
    "/mypage/:path*",
    "/en/dashboard/:path*",
    "/en/mypage/:path*",
    "/dev/inicis-stdpay",
    "/api/dev/inicis/stdpay/:path*",
    "/api/dev/inicis/stdpay-return/:path*",
  ],
};
