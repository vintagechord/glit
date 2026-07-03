import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("profanity_terms")
    .select("term, language")
    .eq("is_active", true)
    .order("term", { ascending: true });

  if (error) {
    console.error("[profanity terms] query failed", error);
    return NextResponse.json(
      { error: "PROFANITY_TERMS_QUERY_FAILED" },
      { status: 500 },
    );
  }

  return NextResponse.json(
    {
      terms:
        data?.map((row) => ({
          term: row.term,
          language: row.language,
        })) ?? [],
    },
    {
      headers: {
        "Cache-Control": "public, max-age=300, stale-while-revalidate=3600",
      },
    },
  );
}
