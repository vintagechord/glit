import { NextResponse } from "next/server";

import { getSubmissionCartCount } from "@/lib/submission-cart";
import { createServerSupabase } from "@/lib/supabase/server";
import { getServerSessionUser } from "@/lib/supabase/server-user";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const supabase = await createServerSupabase();
  const user = await getServerSessionUser(supabase);

  if (!user) {
    return NextResponse.json({ count: 0, totalAmountKrw: 0 });
  }

  const { count, totalAmountKrw, error } = await getSubmissionCartCount(user.id);
  if (error) {
    console.error("[CartCount] query failed", error);
    return NextResponse.json({ count: 0, totalAmountKrw: 0 }, { status: 200 });
  }

  return NextResponse.json({ count, totalAmountKrw });
}
