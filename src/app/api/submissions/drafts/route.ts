import { revalidatePath } from "next/cache";
import { after, NextResponse } from "next/server";
import { z } from "zod";

import { clearDashboardStatusCache } from "@/lib/dashboard-status";
import {
  cleanupDeletedSubmissionB2Objects,
  type SubmissionB2ObjectRef,
} from "@/lib/submission-file-cleanup";
import { readBoundedJsonBody } from "@/lib/request-body";
import {
  consumeRateLimit,
  getRequestIdentifier,
} from "@/lib/request-rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  type: z.enum(["ALBUM", "MV"]),
  ids: z.array(z.string().uuid()).max(100).optional(),
  guestToken: z.string().min(8).max(120).optional(),
  guestTokensBySubmissionId: z
    .record(z.string().uuid(), z.string().min(8).max(120))
    .optional(),
});

const deleteSchema = schema.extend({
  ids: z.array(z.string().uuid()).min(1).max(100),
});

const selectAlbumColumns = [
  "id",
  "type",
  "status",
  "payment_status",
  "user_id",
  "guest_token",
  "package_id",
  "amount_krw",
  "album_price_tier",
  "album_draft_group_id",
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
  "ai_used",
  "payment_method",
  "bank_depositor_name",
  "payment_document_type",
  "cash_receipt_purpose",
  "cash_receipt_phone",
  "cash_receipt_business_number",
  "tax_invoice_business_number",
  "application_form_mode",
  "files_submitted_by_email",
  "created_at",
  "updated_at",
].join(",");

const selectMvColumns = [
  "id",
  "type",
  "status",
  "payment_status",
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
  "mv_selected_station_codes",
  "ai_used",
  "payment_method",
  "bank_depositor_name",
  "payment_document_type",
  "cash_receipt_purpose",
  "cash_receipt_phone",
  "cash_receipt_business_number",
  "tax_invoice_business_number",
  "application_form_mode",
  "files_submitted_by_email",
  "created_at",
  "updated_at",
].join(",");

const selectTrackColumns = [
  "submission_id",
  "track_no",
  "track_title",
  "performer",
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

const incompletePaymentFilter =
  "payment_status.is.null,payment_status.in.(UNPAID,PAYMENT_PENDING)";
const loadableDraftStatuses = [
  "DRAFT",
  "PRE_REVIEW",
  "SUBMITTED",
  "WAITING_PAYMENT",
];
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

const getDraftRateLimitResponse = (
  request: Request,
  namespace: string,
  limit: number,
) => {
  const result = consumeRateLimit({
    namespace,
    identifier: getRequestIdentifier(request.headers),
    limit,
    windowMs: 15 * 60 * 1_000,
  });
  return result.allowed
    ? null
    : NextResponse.json(
        { error: "임시저장 요청이 너무 많습니다. 잠시 후 다시 시도해주세요." },
        {
          status: 429,
          headers: { "Retry-After": String(result.retryAfterSeconds) },
        },
      );
};

export async function POST(request: Request) {
  const rateLimitResponse = getDraftRateLimitResponse(
    request,
    "submission-drafts-read-ip",
    120,
  );
  if (rateLimitResponse) return rateLimitResponse;

  const body = await readBoundedJsonBody(request, 32 * 1024);
  if (!body.ok) {
    return NextResponse.json(
      { error: "요청 정보를 확인해주세요." },
      { status: body.reason === "too_large" ? 413 : 400 },
    );
  }
  const parsed = schema.safeParse(body.value ?? {});
  if (!parsed.success) {
    return NextResponse.json({ error: "요청 정보를 확인해주세요." }, { status: 400 });
  }

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isGuest = !user;
  const guestTokensBySubmissionId =
    parsed.data.guestTokensBySubmissionId ?? {};
  const guestTokenEntries = Object.entries(guestTokensBySubmissionId);
  const guestTokens = Array.from(
    new Set(guestTokenEntries.map(([, token]) => token)),
  );
  if (guestTokenEntries.length > 100) {
    return NextResponse.json({ error: "요청 정보를 확인해주세요." }, { status: 400 });
  }
  if (
    isGuest &&
    !parsed.data.guestToken &&
    guestTokenEntries.length === 0
  ) {
    return NextResponse.json({ error: "로그인 또는 게스트 토큰이 필요합니다." }, { status: 401 });
  }
  const requestedIds = Array.from(
    new Set(
      parsed.data.ids?.length
        ? parsed.data.ids
        : guestTokenEntries.map(([submissionId]) => submissionId),
    ),
  );

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
      .or(incompletePaymentFilter)
      .in("status", loadableDraftStatuses);

    if (parsed.data.type === "ALBUM") {
      submissionQuery.eq("type", "ALBUM");
    } else {
      submissionQuery.in("type", ["MV_DISTRIBUTION", "MV_BROADCAST"]);
    }

    if (requestedIds.length > 0) {
      submissionQuery.in("id", requestedIds);
    }

    if (user?.id) {
      submissionQuery.eq("user_id", user.id);
    } else if (guestTokenEntries.length > 0) {
      submissionQuery
        .is("user_id", null)
        .in("guest_token", guestTokens);
    } else if (parsed.data.guestToken) {
      submissionQuery
        .is("user_id", null)
        .eq("guest_token", parsed.data.guestToken);
    }

    submissionQuery.order("updated_at", { ascending: false }).limit(100);
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
    console.error("[Drafts] failed to load submission drafts", {
      type: parsed.data.type,
      isGuest,
      code: submissionResult.error.code,
      message: submissionResult.error.message,
    });
    if (isGuest) {
      return NextResponse.json({ ok: true, drafts: [] });
    }
    return NextResponse.json({ error: "임시 저장 정보를 불러올 수 없습니다." }, { status: 500 });
  }

  const loadedSubmissions = (submissionResult.data ?? []) as unknown as Array<
    Record<string, unknown>
  >;
  let submissions =
    isGuest && guestTokenEntries.length > 0
      ? loadedSubmissions.filter((row) => {
          const submissionId = String(row.id ?? "");
          return (
            !row.user_id &&
            typeof row.guest_token === "string" &&
            guestTokensBySubmissionId[submissionId] === row.guest_token
          );
        })
      : loadedSubmissions;
  if (parsed.data.type === "ALBUM" && submissions.length > 0) {
    const groupIds = Array.from(
      new Set(
        submissions
          .map((row) => String(row.album_draft_group_id ?? ""))
          .filter(Boolean),
      ),
    );
    if (groupIds.length > 0) {
      const groupQuery = admin
        .from("submissions")
        .select(selectClause)
        .eq("type", "ALBUM")
        .or(incompletePaymentFilter)
        .in("status", loadableDraftStatuses)
        .in("album_draft_group_id", groupIds)
        .order("created_at", { ascending: true })
        .limit(100);
      if (user?.id) {
        groupQuery.eq("user_id", user.id);
      } else {
        // Possession of one exact guest token authorizes only its server-bound
        // draft bundle. The group id itself is service-role protected.
        groupQuery.is("user_id", null);
      }
      const groupResult = await groupQuery;
      if (!groupResult.error) {
        const byId = new Map(
          submissions.map((row) => [String(row.id ?? ""), row] as const),
        );
        for (const row of (groupResult.data ?? []) as unknown as Array<
          Record<string, unknown>
        >) {
          const id = String(row.id ?? "");
          if (id) byId.set(id, row);
        }
        submissions = Array.from(byId.values());
      }
    }
  }
  const submissionIds = submissions
    .map((row) => String(row.id ?? ""))
    .filter(Boolean);
  if (submissionIds.length === 0) {
    return NextResponse.json({ ok: true, drafts: [] });
  }

  const drafts = submissions ?? [];

  let trackRows: Array<Record<string, unknown>> = [];
  let stationReviewRows: Array<Record<string, unknown>> = [];
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
  } else {
    const stationResult = await admin
      .from("station_reviews")
      .select("submission_id, station:stations ( code )")
      .in("submission_id", submissionIds);

    if (!stationResult.error) {
      stationReviewRows = (stationResult.data ?? []) as unknown as Array<
        Record<string, unknown>
      >;
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

  // Completion is provisional for every applicant upload. Return owned
  // staging rows too so another device can recover B2-verified files that
  // have not reached an explicit save. Live rows stay first and therefore win
  // the path/name/size dedupe below if an idempotent retry left both sources.
  const stagedFileResult = await admin
    .from("submission_upload_staging")
    .select(selectFileColumns)
    .in("submission_id", submissionIds)
    .eq("purpose", "SUBMISSION_FILE")
    .order("uploaded_at", { ascending: true });
  if (!stagedFileResult.error) {
    fileRows = [
      ...fileRows,
      ...((stagedFileResult.data ?? []) as unknown as Array<
        Record<string, unknown>
      >),
    ];
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
    const objectPath = String(row.object_key ?? row.file_path ?? "").trim();
    const dedupeKey =
      objectPath ||
      [String(row.original_name ?? ""), String(row.size ?? "")].join("|");
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

  const stationReviewsBySubmission = new Map<
    string,
    Array<Record<string, unknown>>
  >();
  stationReviewRows.forEach((row) => {
    const submissionId = String(row.submission_id ?? "");
    if (!submissionId) return;
    const list = stationReviewsBySubmission.get(submissionId) ?? [];
    list.push(row);
    stationReviewsBySubmission.set(submissionId, list);
  });

  const payload = drafts.map((draft) => ({
    ...draft,
    tracks: tracksBySubmission.get(String(draft.id)) ?? [],
    files: filesBySubmission.get(String(draft.id)) ?? [],
    station_reviews: stationReviewsBySubmission.get(String(draft.id)) ?? [],
  }));

  return NextResponse.json({ ok: true, drafts: payload });
}

export async function DELETE(request: Request) {
  const rateLimitResponse = getDraftRateLimitResponse(
    request,
    "submission-drafts-delete-ip",
    60,
  );
  if (rateLimitResponse) return rateLimitResponse;

  const body = await readBoundedJsonBody(request, 32 * 1024);
  if (!body.ok) {
    return NextResponse.json(
      { error: "요청 정보를 확인해주세요." },
      { status: body.reason === "too_large" ? 413 : 400 },
    );
  }
  const parsed = deleteSchema.safeParse(body.value ?? {});
  if (!parsed.success) {
    return NextResponse.json({ error: "요청 정보를 확인해주세요." }, { status: 400 });
  }

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isGuest = !user;
  const guestTokensBySubmissionId =
    parsed.data.guestTokensBySubmissionId ?? {};
  const guestTokenEntries = Object.entries(guestTokensBySubmissionId);
  if (guestTokenEntries.length > 100) {
    return NextResponse.json({ error: "요청 정보를 확인해주세요." }, { status: 400 });
  }
  if (
    isGuest &&
    !parsed.data.guestToken &&
    guestTokenEntries.length === 0
  ) {
    return NextResponse.json({ error: "로그인 또는 게스트 토큰이 필요합니다." }, { status: 401 });
  }

  const admin = createAdminClient();
  const requestedIds = Array.from(new Set(parsed.data.ids));
  const exactGuestTokens = isGuest
    ? Object.fromEntries(
        requestedIds.map((id) => [
          id,
          guestTokensBySubmissionId[id] ?? parsed.data.guestToken ?? "",
        ]),
      )
    : {};
  const { data, error } = await admin.rpc("delete_submission_drafts_atomic", {
    p_type: parsed.data.type,
    p_requested_ids: requestedIds,
    p_user_id: user?.id ?? null,
    p_guest_tokens_by_submission_id: exactGuestTokens,
  });
  if (error) {
    const conflict = ["22023", "42501", "55000", "P0002", "40001"].includes(
      error.code ?? "",
    );
    return NextResponse.json(
      {
        error: conflict
          ? "일부 임시저장 항목이 변경되어 삭제하지 못했습니다. 새로고침 후 다시 시도해주세요."
          : "임시저장 삭제에 실패했습니다.",
      },
      { status: conflict ? 409 : 500 },
    );
  }
  const result = data as
    | { deletedIds?: unknown; b2ObjectRefs?: unknown }
    | null;
  const deletedIds = Array.isArray(result?.deletedIds)
    ? result.deletedIds.filter(
        (value): value is string => typeof value === "string",
      )
    : [];
  const b2ObjectRefs = Array.isArray(result?.b2ObjectRefs)
    ? result.b2ObjectRefs.filter(
        (value): value is SubmissionB2ObjectRef =>
          Boolean(
            value &&
              typeof value === "object" &&
              typeof (value as SubmissionB2ObjectRef).submissionId === "string" &&
              typeof (value as SubmissionB2ObjectRef).objectKey === "string",
          ),
      )
    : [];
  if (deletedIds.length > 0 && b2ObjectRefs.length > 0) {
    after(() =>
      cleanupDeletedSubmissionB2Objects(admin, b2ObjectRefs, deletedIds),
    );
  }
  if (user) {
    clearDashboardStatusCache(user.id);
  }
  revalidatePath("/dashboard");
  revalidatePath("/mypage");
  revalidatePath("/dashboard/drafts");
  revalidatePath("/mypage/drafts");
  revalidatePath("/en/dashboard");
  revalidatePath("/en/mypage");
  revalidatePath("/en/dashboard/drafts");
  revalidatePath("/en/mypage/drafts");

  return NextResponse.json({ ok: true, deletedIds });
}
