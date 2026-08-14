import { NextResponse } from "next/server";

import { getSafeInternalPath } from "@/lib/safe-internal-path";
import { createServerSupabase } from "@/lib/supabase/server";
import { getBaseUrl } from "@/lib/url";

export async function POST(request: Request) {
  const supabase = await createServerSupabase();
  await supabase.auth.signOut();

  const requestedPath = (() => {
    try {
      return getSafeInternalPath(new URL(request.url).searchParams.get("next"));
    } catch {
      return null;
    }
  })();
  const redirectUrl = new URL(requestedPath ?? "/", getBaseUrl(request));

  return NextResponse.redirect(redirectUrl, { status: 303 });
}
