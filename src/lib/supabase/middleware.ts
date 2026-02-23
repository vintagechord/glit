import { createServerClient } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server";

import { getSupabaseEnv } from "./env";

const devStdPayCsp = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "img-src 'self' data: blob: https://stgstdpay.inicis.com https://stdux.inicis.com",
  "font-src 'self' data:",
  "connect-src 'self' ws: http://localhost:3000 https://stgstdpay.inicis.com https://stdpay.inicis.com",
  "frame-src 'self' https://stgstdpay.inicis.com https://stdpay.inicis.com",
  "script-src 'self' 'unsafe-inline' https://stgstdpay.inicis.com https://stdpay.inicis.com https://stdux.inicis.com",
  "script-src-elem 'self' 'unsafe-inline' https://stgstdpay.inicis.com https://stdpay.inicis.com https://stdux.inicis.com",
  "style-src 'self' 'unsafe-inline' https://stgstdpay.inicis.com https://stdpay.inicis.com",
  "style-src-elem 'self' 'unsafe-inline' https://stgstdpay.inicis.com https://stdpay.inicis.com",
].join("; ");

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const { url, anonKey } = getSupabaseEnv();

  const res = NextResponse.next();

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return req.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          res.cookies.set(name, value, options);
        });
      },
    },
  });

  // `getUser` always calls Auth server; use `getSession` in middleware to
  // avoid extra network latency on each navigation.
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const user = session?.user ?? null;

  if (process.env.NODE_ENV === "development" && pathname === "/dev/inicis-stdpay") {
    res.headers.set("Content-Security-Policy", devStdPayCsp);
  }

  return { response: res, user, supabase };
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
