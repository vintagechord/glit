import { NextResponse } from "next/server";

import { createServerSupabase } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const supabase = await createServerSupabase();
  await supabase.auth.signOut();

  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  let requestOrigin: string | null = null;
  try {
    const { origin } = new URL(request.url);
    requestOrigin = origin;
  } catch {
    requestOrigin = null;
  }
  const headerOrigin = request.headers.get("origin")?.trim();
  const fallbackBase = appUrl || requestOrigin || headerOrigin || "/";
  let redirectUrl: URL;
  try {
    redirectUrl = new URL(fallbackBase);
  } catch {
    const origin = requestOrigin ?? headerOrigin ?? "http://localhost:3000";
    redirectUrl = new URL("/", origin);
  }

  return NextResponse.redirect(redirectUrl, { status: 303 });
}
