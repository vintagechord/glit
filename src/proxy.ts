import { NextResponse, type NextRequest } from "next/server";

import { getAuthReturnPath } from "@/features/auth/navigation";
import { requiresSocialSignupCompletion } from "@/features/auth/social-contract";
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
  for (const name of ["Cache-Control", "Expires", "Pragma"]) {
    const value = source.headers.get(name);
    if (value) target.headers.set(name, value);
  }
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

function signupCompletionResponse(request: NextRequest, response: NextResponse) {
  const isApi = request.nextUrl.pathname.startsWith("/api/");
  let english = request.nextUrl.pathname === "/en" || request.nextUrl.pathname.startsWith("/en/");
  let returnPath = `${request.nextUrl.pathname}${request.nextUrl.search}`;
  if (isApi) {
    returnPath = "/mypage";
    try {
      const referrer = new URL(request.headers.get("referer") ?? "");
      if (referrer.origin === request.nextUrl.origin) {
        english = referrer.pathname === "/en" || referrer.pathname.startsWith("/en/");
        returnPath = `${referrer.pathname}${referrer.search}`;
      }
    } catch { /* API requests without a page return to My Page. */ }
  }
  const url = request.nextUrl.clone();
  url.pathname = english ? "/en/complete-signup" : "/complete-signup";
  url.search = "";
  url.searchParams.set("next", getAuthReturnPath(returnPath, english) ?? `${english ? "/en" : ""}/mypage`);
  const blocked = isApi
    ? NextResponse.json({
      error: "회원가입 동의를 완료해주세요.",
      code: "SOCIAL_SIGNUP_INCOMPLETE",
      redirectTo: `${url.pathname}${url.search}`,
    }, { status: 403 })
    : NextResponse.redirect(url);
  const result = withCookies(blocked, response);
  result.headers.set("Cache-Control", "private, no-store");
  return result;
}

export default async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isEnglishRoute = pathname === "/en" || pathname.startsWith("/en/");
  const authPathname =
    isEnglishRoute && pathname !== "/en"
      ? pathname.replace(/^\/en(?=\/)/, "")
      : pathname;
  // Consent, identity callbacks and recovery must remain reachable. These
  // handlers perform their own verification; callbacks also own PKCE cookies.
  if (/^\/(?:login|signup|forgot-password|reset-password|find-id|confirm-email|complete-signup|privacy|terms|logout|auth)(?:\/|$)/.test(authPathname) ||
      /^\/api\/auth(?:\/|$)/.test(authPathname)) {
    return NextResponse.next();
  }
  const isDev = process.env.NODE_ENV !== "production";
  const isDevStdPayPath =
    pathname === "/dev/inicis-stdpay" ||
    pathname.startsWith("/api/dev/inicis/stdpay") ||
    pathname.startsWith("/api/dev/inicis/stdpay-return");
  const isAdminRoute = authPathname.startsWith("/admin");
  const isDashboardRoute = authPathname.startsWith("/dashboard");
  const isMypageRoute = authPathname.startsWith("/mypage");
  const isPublicCommerceRoute =
    ["/mypage/cart", "/dashboard/cart", "/mypage/orders", "/dashboard/orders"].includes(authPathname);
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
    isPublicCommerceRoute ||
    (isSubmissionDetailRoute && hasPaymentResultGrant);
  const isUserProtectedRoute =
    (isDashboardRoute && !isPublicDashboardRoute) ||
    (isMypageRoute && !isPublicCommerceRoute);
  const requiresSessionCookie =
    isUserProtectedRoute || isAdminRoute;

  if (!requiresSessionCookie) {
    // Reading the local session is only an optimistic redirect check. The
    // server client's verified getUser guard is authoritative for data access.
    // This also persists rotated cookies on public pages without an extra
    // remote user lookup or any auth work for cookie-free visitors.
    if (hasSupabaseAuthCookie(request)) {
      const refreshed = await updateSession(request);
      const refreshedResponse =
        refreshed instanceof NextResponse ? refreshed : (refreshed?.response as NextResponse | undefined);
      if (refreshedResponse) {
        const refreshedUser = refreshed instanceof NextResponse ? null : refreshed?.user;
        if (refreshedUser && requiresSocialSignupCompletion(refreshedUser)) {
          return signupCompletionResponse(request, refreshedResponse);
        }
        if (isDev && isDevStdPayPath) {
          refreshedResponse.headers.set("Content-Security-Policy", devStdPayCsp);
        }
        return refreshedResponse;
      }
    }
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
  if (user && requiresSocialSignupCompletion(user)) {
    return signupCompletionResponse(request, response);
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
    "/((?!_next/|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|woff2?|ttf|map)$).*)",
  ],
};
