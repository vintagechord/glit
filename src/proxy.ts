import { NextResponse, type NextRequest } from "next/server";

import { updateSession } from "@/lib/supabase/middleware";

function withCookies(target: NextResponse, source: NextResponse) {
  source.cookies.getAll().forEach((cookie) => {
    target.cookies.set(cookie);
  });
  return target;
}

export default async function proxy(request: NextRequest) {
  const { response, user, supabase } = await updateSession(request);
  const { pathname } = request.nextUrl;
  const isAdminRoute = pathname.startsWith("/admin");
  const isDashboardRoute = pathname.startsWith("/dashboard");
  const isPublicDashboardRoute = pathname.startsWith("/dashboard/new");
  const isProtected =
    (isDashboardRoute && !isPublicDashboardRoute) || isAdminRoute;

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
    return withCookies(NextResponse.redirect(redirectUrl), response);
  }

  if (isAdminRoute && user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!profile || profile.role !== "admin") {
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = "/dashboard";
      return withCookies(NextResponse.redirect(redirectUrl), response);
    }
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
