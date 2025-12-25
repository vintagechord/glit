import { NextResponse } from "next/server";

import { createServerSupabase } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const supabase = createServerSupabase();
  await supabase.auth.signOut();

  const redirectUrl = new URL("/", request.url);
  return NextResponse.redirect(redirectUrl, { status: 303 });
}
