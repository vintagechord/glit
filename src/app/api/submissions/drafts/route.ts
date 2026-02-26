import { NextResponse } from "next/server";
import { z } from "zod";

import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  type: z.enum(["ALBUM", "MV"]),
  ids: z.array(z.string().uuid()).optional(),
  guestToken: z.string().min(8).optional(),
});

const deleteSchema = schema.extend({
  ids: z.array(z.string().uuid()).min(1),
});

const selectAlbumColumns = [
  "id",
  "type",
  "status",
  "user_id",
  "guest_token",
  "package_id",
  "amount_krw",
  "title",
  "artist_name",
  "artist_name_kr",
  "artist_name_en",
  "release_date",
  "genre",
  "distributor",
  "production_company",
  "applicant_name",
  "applicant_email",
  "applicant_phone",
  "previous_release",
  "artist_type",
  "artist_gender",
  "artist_members",
  "is_oneclick",
  "melon_url",
  "payment_method",
  "bank_depositor_name",
  "payment_document_type",
  "cash_receipt_purpose",
  "cash_receipt_phone",
  "cash_receipt_business_number",
  "tax_invoice_business_number",
  "created_at",
  "updated_at",
].join(",");

const selectMvColumns = [
  "id",
  "type",
  "status",
  "user_id",
  "guest_token",
  "package_id",
  "amount_krw",
  "title",
  "artist_name",
  "artist_name_kr",
  "release_date",
  "genre",
  "applicant_email",
  "guest_name",
  "guest_company",
  "guest_email",
  "guest_phone",
  "mv_runtime",
  "mv_format",
  "mv_director",
  "mv_lead_actor",
  "mv_storyline",
  "mv_production_company",
  "mv_agency",
  "mv_album_title",
  "mv_production_date",
  "mv_distribution_company",
  "mv_business_reg_no",
  "mv_usage",
  "mv_desired_rating",
  "mv_memo",
  "mv_song_title",
  "mv_song_title_kr",
  "mv_song_title_en",
  "mv_song_title_official",
  "mv_composer",
  "mv_lyricist",
  "mv_arranger",
  "mv_song_memo",
  "mv_lyrics",
  "mv_base_selected",
  "payment_method",
  "bank_depositor_name",
  "payment_document_type",
  "cash_receipt_purpose",
  "cash_receipt_phone",
  "cash_receipt_business_number",
  "tax_invoice_business_number",
  "created_at",
  "updated_at",
].join(",");

const selectTrackColumns = [
  "submission_id",
  "track_no",
  "track_title",
  "featuring",
  "composer",
  "lyricist",
  "arranger",
  "lyrics",
  "translated_lyrics",
  "notes",
  "is_title",
  "title_role",
  "broadcast_selected",
].join(",");

const selectFileColumns = [
  "submission_id",
  "kind",
  "file_path",
  "object_key",
  "original_name",
  "mime",
  "size",
  "access_url",
  "checksum",
  "duration_seconds",
].join(",");

const draftStatuses = ["DRAFT", "PRE_REVIEW"] as const;

const extractMissingColumn = (error: { message?: string; code?: string } | null) => {
  const message = error?.message ?? "";
  const match =
    message.match(/'([^']+)' column/i) ||
    message.match(/column \"([^\"]+)\"/i);
  return match?.[1] ?? null;
};

const dropColumnFromSelect = (selectClause: string, column: string) =>
  selectClause
    .split(",")
    .map((item) => item.trim())
    .filter((item) => !item.includes(column))
    .join(",");

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json({ error: "요청 정보를 확인해주세요." }, { status: 400 });
  }

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isGuest = !user;
  if (isGuest && !parsed.data.guestToken) {
    return NextResponse.json({ error: "로그인 또는 게스트 토큰이 필요합니다." }, { status: 401 });
  }

  const admin = createAdminClient();
  let selectClause =
    parsed.data.type === "ALBUM" ? selectAlbumColumns : selectMvColumns;
  let submissionResult: {
    data: unknown;
    error: { message?: string; code?: string } | null;
  } | null = null;

  const maxAttempts = Math.max(6, selectClause.split(",").length);
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const submissionQuery = admin
      .from("submissions")
      .select(selectClause)
      .in("status", [...draftStatuses]);

    if (parsed.data.type === "ALBUM") {
      submissionQuery.eq("type", "ALBUM");
    } else {
      submissionQuery.in("type", ["MV_DISTRIBUTION", "MV_BROADCAST"]);
    }

    if (parsed.data.ids && parsed.data.ids.length > 0) {
      submissionQuery.in("id", parsed.data.ids);
    }

    if (user?.id) {
      submissionQuery.eq("user_id", user.id);
    } else if (parsed.data.guestToken) {
      submissionQuery.eq("guest_token", parsed.data.guestToken);
    }

    submissionQuery.order("updated_at", { ascending: false }).limit(10);
    submissionResult = await submissionQuery;
    if (!submissionResult.error) {
      break;
    }

    const missing = extractMissingColumn(submissionResult.error);
    if (!missing) {
      break;
    }
    const next = dropColumnFromSelect(selectClause, missing);
    if (next === selectClause) {
      break;
    }
    selectClause = next;
  }

  if (!submissionResult) {
    return NextResponse.json(
      { error: "임시 저장 정보를 불러올 수 없습니다." },
      { status: 500 },
    );
  }

  if (submissionResult.error) {
    return NextResponse.json({ error: "임시 저장 정보를 불러올 수 없습니다." }, { status: 500 });
  }

  const submissions = (submissionResult.data ?? []) as unknown as Array<
    Record<string, unknown>
  >;
  const submissionIds = submissions
    .map((row) => String(row.id ?? ""))
    .filter(Boolean);
  if (submissionIds.length === 0) {
    return NextResponse.json({ ok: true, drafts: [] });
  }

  const drafts = submissions ?? [];

  let trackRows: Array<Record<string, unknown>> = [];
  if (parsed.data.type === "ALBUM") {
    let trackSelectClause = selectTrackColumns;
    const maxTrackAttempts = Math.max(6, trackSelectClause.split(",").length);
    for (let attempt = 0; attempt < maxTrackAttempts; attempt += 1) {
      const tracksResult = await admin
        .from("album_tracks")
        .select(trackSelectClause)
        .in("submission_id", submissionIds)
        .order("track_no", { ascending: true });
      if (!tracksResult.error) {
        trackRows = (tracksResult.data ?? []) as unknown as Array<
          Record<string, unknown>
        >;
        break;
      }
      const missing = extractMissingColumn(tracksResult.error);
      if (!missing) {
        break;
      }
      const next = dropColumnFromSelect(trackSelectClause, missing);
      if (next === trackSelectClause) {
        break;
      }
      trackSelectClause = next;
    }
  }

  const fileKind = parsed.data.type === "ALBUM" ? "AUDIO" : "VIDEO";
  let fileRows: Array<Record<string, unknown>> = [];
  const fileQuery = admin
    .from("submission_files")
    .select(selectFileColumns)
    .in("submission_id", submissionIds)
    .eq("kind", fileKind);
  const fileResult = await fileQuery;
  if (!fileResult.error) {
    fileRows = (fileResult.data ?? []) as unknown as Array<
      Record<string, unknown>
    >;
  } else if (fileResult.error.code === "42703") {
    const fallbackResult = await admin
      .from("submission_files")
      .select("submission_id, kind, file_path, object_key, original_name, mime, size")
      .in("submission_id", submissionIds)
      .eq("kind", fileKind);
    fileRows = (fallbackResult.data ?? []) as unknown as Array<
      Record<string, unknown>
    >;
  }

  const tracksBySubmission = new Map<string, Array<Record<string, unknown>>>();
  trackRows.forEach((row) => {
    const submissionId = String(row.submission_id ?? "");
    if (!submissionId) return;
    const list = tracksBySubmission.get(submissionId) ?? [];
    list.push(row);
    tracksBySubmission.set(submissionId, list);
  });

  const filesBySubmission = new Map<string, Array<Record<string, unknown>>>();
  const seenFileKeysBySubmission = new Map<string, Set<string>>();
  fileRows.forEach((row) => {
    const submissionId = String(row.submission_id ?? "");
    if (!submissionId) return;
    const dedupeKey = [
      String(row.object_key ?? row.file_path ?? ""),
      String(row.original_name ?? ""),
      String(row.size ?? ""),
    ].join("|");
    const seen = seenFileKeysBySubmission.get(submissionId) ?? new Set<string>();
    if (seen.has(dedupeKey)) {
      return;
    }
    seen.add(dedupeKey);
    seenFileKeysBySubmission.set(submissionId, seen);
    const list = filesBySubmission.get(submissionId) ?? [];
    list.push(row);
    filesBySubmission.set(submissionId, list);
  });

  const payload = drafts.map((draft) => ({
    ...draft,
    tracks: tracksBySubmission.get(String(draft.id)) ?? [],
    files: filesBySubmission.get(String(draft.id)) ?? [],
  }));

  return NextResponse.json({ ok: true, drafts: payload });
}

export async function DELETE(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = deleteSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json({ error: "요청 정보를 확인해주세요." }, { status: 400 });
  }

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isGuest = !user;
  if (isGuest && !parsed.data.guestToken) {
    return NextResponse.json({ error: "로그인 또는 게스트 토큰이 필요합니다." }, { status: 401 });
  }

  const admin = createAdminClient();
  const deleteQuery = admin
    .from("submissions")
    .delete()
    .in("status", [...draftStatuses]);

  if (parsed.data.type === "ALBUM") {
    deleteQuery.eq("type", "ALBUM");
  } else {
    deleteQuery.in("type", ["MV_DISTRIBUTION", "MV_BROADCAST"]);
  }

  deleteQuery.in("id", parsed.data.ids);

  if (user?.id) {
    deleteQuery.eq("user_id", user.id);
  } else {
    deleteQuery.eq("guest_token", parsed.data.guestToken as string);
  }

  const { error } = await deleteQuery;
  if (error) {
    return NextResponse.json({ error: "임시저장 삭제에 실패했습니다." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
