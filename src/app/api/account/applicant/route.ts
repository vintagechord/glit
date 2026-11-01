import { NextResponse } from "next/server";

import { loadMemberApplicant } from "@/lib/member-applicant";
import { createServerSupabase } from "@/lib/supabase/server";
import { getServerSessionUser } from "@/lib/supabase/server-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "private, no-store" };

/**
 * The application pages are served from the CDN; this verifies the visitor's
 * session and returns the member identity and contact defaults they prefill.
 */
export async function GET() {
  const supabase = await createServerSupabase();
  const user = await getServerSessionUser(supabase);
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401, headers: noStore });
  const applicant = await loadMemberApplicant(supabase, user);
  return NextResponse.json({ userId: user.id, userEmail: user.email ?? null, applicant }, { headers: noStore });
}
