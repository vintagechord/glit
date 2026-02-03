import { NextRequest, NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

// NOTE: context.params is Promise<{id:string}> on Next.js route handlers.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: submissionId } = await params;
  if (!submissionId) {
    return NextResponse.json({ error: "Submission ID missing" }, { status: 400 });
  }

  const supabase = createAdminClient();
  const select =
    "*, package:packages ( name, station_count ), album_tracks ( * ), station_reviews ( id, status, result_note, track_results:track_results_json, updated_at, station:stations ( id, name, code ) ), submission_files ( id, kind, file_path, original_name, mime, size, created_at )";
  const selectLegacy =
    "*, package:packages ( name, station_count ), album_tracks ( * ), station_reviews ( id, status, result_note, track_results, updated_at, station:stations ( id, name, code ) ), submission_files ( id, kind, file_path, original_name, mime, size, created_at )";

  let { data, error } = await supabase
    .from("submissions")
    .select(select)
    .eq("id", submissionId)
    .maybeSingle();

  const missingTrackColumn =
    error?.code === "42703" ||
    error?.message?.toLowerCase().includes("track_results_json") ||
    error?.message?.toLowerCase().includes("track_results");
  if (error && missingTrackColumn) {
    const fallback = await supabase
      .from("submissions")
      .select(selectLegacy)
      .eq("id", submissionId)
      .maybeSingle();
    data = fallback.data ?? data;
    error = fallback.error ?? error;
  }

  if (error || !data) {
    return NextResponse.json(
      { error: "Submission not found", detail: error?.message },
      { status: 404 },
    );
  }

  const body = JSON.stringify(data, null, 2);
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="submission-${submissionId}.json"`,
    },
  });
}
