import { NextResponse } from "next/server";

import { createServerSupabase } from "@/lib/supabase/server";
import { getServerSessionUser } from "@/lib/supabase/server-user";
import { getDashboardStatusData } from "@/lib/dashboard-status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createServerSupabase();
  const user = await getServerSessionUser(supabase);

  if (!user) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const result = await getDashboardStatusData(user.id);
  if (result.error || !result.data) {
    return NextResponse.json(
      { error: result.error ?? "STATUS_QUERY_FAILED" },
      { status: 500 },
    );
  }

  return NextResponse.json(result.data, {
    headers: {
      "Cache-Control": "private, max-age=30, stale-while-revalidate=30",
    },
  });
}
