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
  const isProtected =
    (isDashboardRoute && !isPublicDashboardRoute) || isAdminRoute || isMypageRoute;

  // Skip Supabase auth round-trip on public routes to keep navigation snappy.
  if (!isProtected) {
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

  if (isProtected && !user) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/login";
    redirectUrl.searchParams.set("next", pathname);
    const redirectRes = withCookies(NextResponse.redirect(redirectUrl), response);
    if (isDev && isDevStdPayPath) {
      redirectRes.headers.set("Content-Security-Policy", devStdPayCsp);
    }
    return redirectRes;
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

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
