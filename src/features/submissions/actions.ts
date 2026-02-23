"use server";

import { z } from "zod";

import { ensureAlbumStationReviews } from "@/lib/station-reviews";
import { sendSubmissionReceiptEmail } from "@/lib/email";
import { ensureArtistByName } from "@/lib/artist";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabase } from "@/lib/supabase/server";

export type SubmissionActionState = {
  error?: string;
  submissionId?: string;
  guestToken?: string;
  emailWarning?: string;
};

export type SubmissionFileUrlActionState = {
  error?: string;
  url?: string;
};

type SupabaseError = {
  code?: string | null;
  message?: string | null;
};

type SupabaseClient = Awaited<ReturnType<typeof createServerSupabase>>;

const albumStationCodesByCount: Record<number, string[]> = {
  7: ["KBS", "MBC", "SBS", "CBS", "WBS", "TBS", "YTN"],
  10: ["KBS", "MBC", "SBS", "TBS", "CBS", "PBC", "WBS", "BBS", "YTN", "ARIRANG"],
  13: [
    "KBS",
    "MBC",
    "SBS",
    "TBS",
    "CBS",
    "PBC",
    "WBS",
    "BBS",
    "YTN",
    "GYEONGIN_IFM",
    "TBN",
    "ARIRANG",
    "KISS",
  ],
  15: [
    "KBS",
    "MBC",
    "SBS",
    "TBS",
    "CBS",
    "PBC",
    "WBS",
    "BBS",
    "YTN",
    "GYEONGIN_IFM",
    "TBN",
    "ARIRANG",
    "KISS",
    "FEBC",
    "GUGAK",
  ],
};

const extractMissingColumn = (error: SupabaseError) => {
  const message = error.message ?? "";
  const match =
    message.match(/'([^']+)' column/i) ||
    message.match(/column \"([^\"]+)\"/i);
  return match?.[1] ?? null;
};

const stripColumn = <T extends Record<string, unknown>>(
  payload: T,
  column: string,
) => {
  const next = { ...payload };
  delete next[column];
  return next;
};

const upsertWithColumnFallback = async (
  db: SupabaseClient,
  payload: Record<string, unknown>,
) => {
  let currentPayload = { ...payload };
  const removed = new Set<string>();
  const maxAttempts = Math.max(Object.keys(currentPayload).length, 12);
  let lastError: SupabaseError | null = null;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const { error } = await db
      .from("submissions")
      .upsert(currentPayload, { onConflict: "id" });
    if (!error) {
      return { error: null };
    }
    lastError = error;
    if (error.code === "PGRST204") {
      const missing = extractMissingColumn(error);
      if (missing && missing in currentPayload && !removed.has(missing)) {
        removed.add(missing);
        currentPayload = stripColumn(currentPayload, missing);
        continue;
      }
    }
    return { error };
  }
  return { error: lastError ?? { message: "업데이트 실패" } };
};

const insertWithColumnFallback = async (
  db: SupabaseClient,
  table: "album_tracks" | "submission_files",
  rows: Record<string, unknown>[],
) => {
  let currentRows = rows.map((row) => ({ ...row }));
  const removed = new Set<string>();
  const maxAttempts = Math.max(
    Object.keys(currentRows[0] ?? {}).length,
    12,
  );
  let lastError: SupabaseError | null = null;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const { error } = await db.from(table).insert(currentRows);
    if (!error) {
      return { error: null };
    }
    lastError = error;
    if (error.code === "PGRST204") {
      const missing = extractMissingColumn(error);
      if (missing && missing in currentRows[0] && !removed.has(missing)) {
        removed.add(missing);
        currentRows = currentRows.map((row) => stripColumn(row, missing));
        continue;
      }
    }
    return { error };
  }
  return { error: lastError ?? { message: "삽입 실패" } };
};

const ensureStationReviews = async (
  db: SupabaseClient,
  submissionId: string,
  stationIds: string[],
) => {
  if (stationIds.length === 0) {
    return { error: null };
  }

  const { data: existingReviews, error: existingError } = await db
    .from("station_reviews")
    .select("station_id")
    .eq("submission_id", submissionId);

  if (existingError) {
    return { error: existingError };
  }

  const existingSet = new Set(
    (existingReviews ?? [])
      .map((review) => review.station_id)
      .filter((id): id is string => Boolean(id)),
  );
  const missingStations = stationIds.filter((id) => !existingSet.has(id));

  if (missingStations.length === 0) {
    return { error: null };
  }

  const { error: insertError } = await db.from("station_reviews").insert(
    missingStations.map((stationId) => ({
      submission_id: submissionId,
      station_id: stationId,
      status: "NOT_SENT",
    })),
  );

  return { error: insertError ?? null };
};

const resolveAlbumStationIds = async (
  db: SupabaseClient,
  packageId: string | undefined,
) => {
  if (!packageId) {
    return { stationIds: [], missingCodes: [] as string[] };
  }

  const { data: packageRow, error: packageError } = await db
    .from("packages")
    .select("station_count, name")
    .eq("id", packageId)
    .maybeSingle();

  if (packageError || !packageRow) {
    return { stationIds: [], missingCodes: [] as string[] };
  }

  let resolvedCount = packageRow.station_count ?? null;
  if (!resolvedCount && packageRow.name) {
    const match = packageRow.name.match(/(\d+)/);
    if (match) {
      const parsed = Number(match[1]);
      if (Number.isFinite(parsed)) {
        resolvedCount = parsed;
      }
    }
  }

  const expectedCodes = resolvedCount
    ? albumStationCodesByCount[resolvedCount]
    : null;
  if (!expectedCodes || expectedCodes.length === 0) {
    return { stationIds: [], missingCodes: [] as string[] };
  }

  const { data: stations, error: stationError } = await db
    .from("stations")
    .select("id, code")
    .in("code", expectedCodes);

  if (stationError) {
    return { stationIds: [], missingCodes: expectedCodes };
  }

  const stationMap = new Map(
    (stations ?? []).map((station) => [station.code, station.id]),
  );
  const stationIds = expectedCodes
    .map((code) => stationMap.get(code))
    .filter((id): id is string => Boolean(id));
  const missingCodes = expectedCodes.filter((code) => !stationMap.has(code));

  return { stationIds, missingCodes };
};

const formatSubmissionError = (error: SupabaseError) => {
  const withCode = (message: string) =>
    error.code ? `${message} (오류 코드: ${error.code})` : message;

  if (error.code === "PGRST204") {
    const match = error.message?.match(/'([^']+)' column/i);
    const column = match?.[1];
    return withCode(
      column
        ? `DB 컬럼 '${column}'이 누락되었습니다. Supabase 마이그레이션을 먼저 실행해주세요.`
        : "DB 컬럼이 누락되었습니다. Supabase 마이그레이션을 먼저 실행해주세요.",
    );
  }
  if (error.code === "23503") {
    return withCode(
      "패키지 또는 방송국 정보가 올바르지 않습니다. 새로고침 후 다시 시도해주세요.",
    );
  }
  if (error.code === "23502") {
    return withCode("필수 입력값이 누락되었습니다. 입력 내용을 다시 확인해주세요.");
  }
  if (error.code === "23505") {
    return withCode(
      "이미 등록된 접수 정보가 있습니다. 새로고침 후 다시 시도해주세요.",
    );
  }
  if (error.code === "42501") {
    return withCode(
      "권한 문제로 접수를 저장할 수 없습니다. 다시 로그인해주세요.",
    );
  }
  if (error.code === "42703") {
    return withCode(
      "DB 컬럼이 누락되었습니다. Supabase 마이그레이션을 먼저 실행해주세요.",
    );
  }
  const loweredMessage = error.message?.toLowerCase() ?? "";
  if (
    loweredMessage.includes("row level security") ||
    loweredMessage.includes("permission")
  ) {
    return withCode(
      "권한 문제로 접수를 저장할 수 없습니다. 다시 로그인해주세요.",
    );
  }
  if (
    loweredMessage.includes("invalid api key") ||
    loweredMessage.includes("jwt")
  ) {
    return withCode(
      "서버 인증 설정에 문제가 있습니다. 관리자에게 문의해주세요.",
    );
  }
  if (error.message) {
    return withCode(`접수 저장에 실패했습니다. (${error.message})`);
  }
  if (error.code) {
    return `접수 저장에 실패했습니다. (오류 코드: ${error.code})`;
  }
  return "접수 저장에 실패했습니다.";
};

const isMissingSessionError = (error: SupabaseError | null | undefined) => {
  const message = error?.message?.toLowerCase() ?? "";
  return message.includes("auth session missing");
};

const isValidEmailFormat = (value: string) =>
  z.string().email().safeParse(value).success;

const trackSchema = z.object({
  trackTitle: z.string().optional(),
  trackTitleKr: z.string().optional(),
  trackTitleEn: z.string().optional(),
  trackTitleOfficial: z.enum(["KR", "EN"]).optional(),
  featuring: z.string().optional(),
  composer: z.string().optional(),
  lyricist: z.string().optional(),
  arranger: z.string().optional(),
  lyrics: z.string().optional(),
  notes: z.string().optional(),
  isTitle: z.boolean().optional(),
  titleRole: z.enum(["MAIN", "SUB"]).optional(),
  broadcastSelected: z.boolean().optional(),
});

const fileSchema = z.object({
  path: z.string().min(1),
  originalName: z.string().min(1),
  mime: z.string().optional(),
  size: z.number().int().nonnegative(),
  checksum: z.string().optional(),
  durationSeconds: z.number().optional(),
  accessUrl: z.string().optional(),
});

const albumSubmissionSchema = z.object({
  submissionId: z.string().uuid(),
  packageId: z.string().uuid().optional(),
  amountKrw: z.number().int().nonnegative().optional(),
  selectedStationIds: z.array(z.string().uuid()).optional(),
  title: z.string().optional(),
  artistName: z.string().optional(),
  artistNameKr: z.string().optional(),
  artistNameEn: z.string().optional(),
  releaseDate: z.string().optional(),
  genre: z.string().optional(),
  distributor: z.string().optional(),
  productionCompany: z.string().optional(),
  applicantName: z.string().optional(),
  applicantEmail: z.string().optional(),
  applicantPhone: z.string().optional(),
  previousRelease: z.string().optional(),
  artistType: z.string().optional(),
  artistGender: z.string().optional(),
  artistMembers: z.string().optional(),
  isOneClick: z.boolean().optional(),
  melonUrl: z.string().optional(),
  guestToken: z.string().min(8).optional(),
  guestName: z.string().optional(),
  guestCompany: z.string().optional(),
  guestEmail: z.string().optional(),
  guestPhone: z.string().optional(),
  preReviewRequested: z.boolean().optional(),
  karaokeRequested: z.boolean().optional(),
  paymentMethod: z.enum(["CARD", "BANK"]).optional(),
  bankDepositorName: z.string().optional(),
  status: z.enum(["DRAFT", "SUBMITTED"]),
  tracks: z.array(trackSchema).optional(),
  files: z.array(fileSchema).optional(),
});

const mvSubmissionSchema = z.object({
  submissionId: z.string().uuid(),
  packageId: z.string().uuid().optional(),
  amountKrw: z.number().int().nonnegative().optional(),
  selectedStationIds: z.array(z.string().uuid()).optional(),
  title: z.string().optional(),
  artistName: z.string().optional(),
  applicantEmail: z.string().optional(),
  director: z.string().optional(),
  leadActor: z.string().optional(),
  storyline: z.string().optional(),
  productionCompany: z.string().optional(),
  agency: z.string().optional(),
  albumTitle: z.string().optional(),
  productionDate: z.string().optional(),
  distributionCompany: z.string().optional(),
  businessRegNo: z.string().optional(),
  usage: z.string().optional(),
  desiredRating: z.string().optional(),
  memo: z.string().optional(),
  songTitle: z.string().optional(),
  songTitleKr: z.string().optional(),
  songTitleEn: z.string().optional(),
  songTitleOfficial: z.enum(["KR", "EN"]).optional(),
  composer: z.string().optional(),
  lyricist: z.string().optional(),
  arranger: z.string().optional(),
  songMemo: z.string().optional(),
  lyrics: z.string().optional(),
  artistNameOfficial: z.string().optional(),
  releaseDate: z.string().optional(),
  genre: z.string().optional(),
  mvType: z.enum(["MV_DISTRIBUTION", "MV_BROADCAST"]),
  runtime: z.string().optional(),
  format: z.string().optional(),
  mvBaseSelected: z.boolean().optional(),
  guestToken: z.string().min(8).optional(),
  guestName: z.string().optional(),
  guestCompany: z.string().optional(),
  guestEmail: z.string().optional(),
  guestPhone: z.string().optional(),
  preReviewRequested: z.boolean().optional(),
  karaokeRequested: z.boolean().optional(),
  paymentMethod: z.enum(["CARD", "BANK"]).optional(),
  bankDepositorName: z.string().optional(),
  status: z.enum(["DRAFT", "SUBMITTED"]),
  files: z.array(fileSchema).optional(),
});

const submissionFileUrlSchema = z.object({
  submissionId: z.string().uuid(),
  fileId: z.string().uuid(),
  guestToken: z.string().min(8).optional(),
});

export async function getSubmissionFileUrlAction(
  payload: z.infer<typeof submissionFileUrlSchema>,
): Promise<SubmissionFileUrlActionState> {
  const parsed = submissionFileUrlSchema.safeParse(payload);
  if (!parsed.success) {
    return { error: "파일 정보를 확인해주세요." };
  }

  const supabase = await createServerSupabase();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError && !isMissingSessionError(userError)) {
    return { error: "로그인 정보를 확인할 수 없습니다." };
  }

  if (user) {
    const { data: fileRow } = await supabase
      .from("submission_files")
      .select("file_path, storage_provider, object_key")
      .eq("id", parsed.data.fileId)
      .eq("submission_id", parsed.data.submissionId)
      .maybeSingle();

    if (!fileRow?.file_path && !fileRow?.object_key) {
      return { error: "파일을 찾을 수 없습니다." };
    }

    if (fileRow.storage_provider === "b2" && fileRow.object_key) {
      try {
        const b2 = await import("@/lib/b2");
        const url = await b2.presignGetUrl(fileRow.object_key, 300);
        return { url };
      } catch (error) {
        const b2 = await import("@/lib/b2");
        if (error instanceof b2.B2ConfigError) {
          return {
            error: "파일 저장소가 아직 설정되지 않았습니다. 관리자에게 문의해주세요.",
          };
        }
        return { error: "다운로드 링크를 생성할 수 없습니다." };
      }
    }

    const { data, error } = await supabase.storage
      .from("submissions")
      .createSignedUrl(fileRow.file_path, 60 * 10);

    if (error || !data?.signedUrl) {
      return { error: "다운로드 링크를 생성할 수 없습니다." };
    }

    return { url: data.signedUrl };
  }

  if (!parsed.data.guestToken) {
    return { error: "접근 권한이 없습니다." };
  }

  const admin = createAdminClient();
  const { data: submission } = await admin
    .from("submissions")
    .select("id, guest_token")
    .eq("id", parsed.data.submissionId)
    .maybeSingle();

  if (!submission || submission.guest_token !== parsed.data.guestToken) {
    return { error: "접근 권한이 없습니다." };
  }

  const { data: fileRow } = await admin
    .from("submission_files")
    .select("file_path, storage_provider, object_key")
    .eq("id", parsed.data.fileId)
    .eq("submission_id", parsed.data.submissionId)
    .maybeSingle();

  if (!fileRow?.file_path && !fileRow?.object_key) {
    return { error: "파일을 찾을 수 없습니다." };
  }

  if (fileRow.storage_provider === "b2" && fileRow.object_key) {
    try {
      const b2 = await import("@/lib/b2");
      const url = await b2.presignGetUrl(fileRow.object_key, 300);
      return { url };
    } catch (error) {
      const b2 = await import("@/lib/b2");
      if (error instanceof b2.B2ConfigError) {
        return {
          error: "파일 저장소가 아직 설정되지 않았습니다. 관리자에게 문의해주세요.",
        };
      }
      return { error: "다운로드 링크를 생성할 수 없습니다." };
    }
  }

  const { data, error } = await admin.storage
    .from("submissions")
    .createSignedUrl(fileRow.file_path, 60 * 10);

  if (error || !data?.signedUrl) {
    return { error: "다운로드 링크를 생성할 수 없습니다." };
  }

  return { url: data.signedUrl };
}

export async function saveAlbumSubmissionAction(
  payload: z.infer<typeof albumSubmissionSchema>,
): Promise<SubmissionActionState> {
  const parsed = albumSubmissionSchema.safeParse(payload);

  if (!parsed.success) {
    return { error: "입력값을 다시 확인해주세요." };
  }

  const supabase = await createServerSupabase();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError && !isMissingSessionError(userError)) {
    return { error: "로그인 정보를 확인할 수 없습니다." };
  }

  const isGuest = !user;
  const isSubmitted = parsed.data.status === "SUBMITTED";
  const isOneClick = parsed.data.isOneClick ?? false;
  const titleValue = parsed.data.title?.trim() ?? "";
  const artistNameValue = parsed.data.artistName?.trim() ?? "";
  const guestNameValue = parsed.data.guestName?.trim() ?? "";
  const guestEmailValue = parsed.data.guestEmail?.trim() ?? "";
  const guestPhoneValue = parsed.data.guestPhone?.trim() ?? "";
  const applicantEmailValue = parsed.data.applicantEmail?.trim() ?? "";
  const bankDepositorNameValue = parsed.data.bankDepositorName?.trim() ?? "";

  if (isGuest && !parsed.data.guestToken) {
    return { error: "로그인 정보를 확인할 수 없습니다." };
  }
  if (
    isSubmitted &&
    isGuest &&
    (!guestNameValue || !guestEmailValue || !guestPhoneValue)
  ) {
    return { error: "비회원 정보(담당자, 연락처, 이메일)를 입력해주세요." };
  }
  if (isSubmitted && isGuest && !isValidEmailFormat(guestEmailValue)) {
    return { error: "비회원 이메일 형식을 확인해주세요." };
  }
  if (isSubmitted && !artistNameValue) {
    return { error: "아티스트명을 입력해주세요. (원클릭 포함)" };
  }
  if (isSubmitted && !isOneClick && !titleValue) {
    return { error: "앨범 제목을 입력해주세요." };
  }

  const adminDb = createAdminClient();
  let db = isGuest ? adminDb : supabase;

  const hasPackage = Boolean(parsed.data.packageId);
  let amountKrw = parsed.data.amountKrw ?? 0;
  let packageStationCount: number | null = null;
  let packageName: string | null = null;

  if (hasPackage && parsed.data.packageId) {
    const { data: selectedPackage, error: packageError } = await db
      .from("packages")
      .select("price_krw, station_count, name")
      .eq("id", parsed.data.packageId)
      .maybeSingle();

    if (packageError || !selectedPackage) {
      return { error: "패키지 정보를 확인할 수 없습니다." };
    }
    packageStationCount = selectedPackage.station_count ?? null;
    packageName = selectedPackage.name ?? null;
    if (amountKrw <= 0) {
      amountKrw = selectedPackage.price_krw;
    }
  }

  if (isSubmitted && amountKrw <= 0) {
    return { error: "결제 금액 정보를 확인할 수 없습니다." };
  }
  amountKrw = Math.max(0, amountKrw);

  const paymentMethod = parsed.data.paymentMethod ?? "BANK";
  if (
    isSubmitted &&
    paymentMethod === "BANK" &&
    !bankDepositorNameValue
  ) {
    return { error: "입금자명을 입력해주세요." };
  }
  const shouldRequestPayment =
    isSubmitted &&
    (paymentMethod === "CARD" || Boolean(bankDepositorNameValue));
  const artistId = await ensureArtistByName(artistNameValue);

  const submissionPayload = {
    id: parsed.data.submissionId,
    user_id: user?.id ?? null,
    type: "ALBUM",
    title: titleValue || null,
    artist_name: artistNameValue || null,
    artist_id: artistId,
    artist_name_kr: parsed.data.artistNameKr?.trim() || null,
    artist_name_en: parsed.data.artistNameEn?.trim() || null,
    release_date: parsed.data.releaseDate || null,
    genre: parsed.data.genre?.trim() || null,
    distributor: parsed.data.distributor?.trim() || null,
    production_company: parsed.data.productionCompany?.trim() || null,
    applicant_name: parsed.data.applicantName?.trim() || null,
    applicant_email: applicantEmailValue || null,
    applicant_phone: parsed.data.applicantPhone?.trim() || null,
    previous_release: parsed.data.previousRelease?.trim() || null,
    artist_type: parsed.data.artistType?.trim() || null,
    artist_gender: parsed.data.artistGender?.trim() || null,
    artist_members: parsed.data.artistMembers?.trim() || null,
    is_oneclick: isOneClick,
    melon_url: parsed.data.melonUrl?.trim() || null,
    package_id: parsed.data.packageId ?? null,
    amount_krw: amountKrw,
    guest_name: isGuest ? guestNameValue || null : null,
    guest_company: isGuest ? parsed.data.guestCompany?.trim() || null : null,
    guest_email: isGuest ? guestEmailValue || null : null,
    guest_phone: isGuest ? guestPhoneValue || null : null,
    guest_token: isGuest ? parsed.data.guestToken : null,
    pre_review_requested: parsed.data.preReviewRequested ?? false,
    karaoke_requested: parsed.data.karaokeRequested ?? false,
    payment_method: paymentMethod,
    bank_depositor_name:
      paymentMethod === "BANK" ? bankDepositorNameValue || null : null,
    status:
      parsed.data.status === "SUBMITTED" && shouldRequestPayment
        ? "WAITING_PAYMENT"
        : parsed.data.status,
    payment_status: shouldRequestPayment ? "PAYMENT_PENDING" : "UNPAID",
  };

  let submissionError = (await upsertWithColumnFallback(db, submissionPayload))
    .error;

  if (submissionError) {
    if (db !== adminDb) {
      const { data: existingSubmission } = await adminDb
        .from("submissions")
        .select("id, user_id, guest_token")
        .eq("id", parsed.data.submissionId)
        .maybeSingle();

      if (
        existingSubmission?.user_id &&
        user &&
        existingSubmission.user_id !== user.id
      ) {
        return {
          error:
            "권한 문제로 접수를 저장할 수 없습니다. 다시 로그인해주세요. (오류 코드: AUTH_MISMATCH)",
        };
      }

      if (
        !existingSubmission?.user_id &&
        existingSubmission?.guest_token &&
        parsed.data.guestToken &&
        existingSubmission.guest_token !== parsed.data.guestToken
      ) {
        return {
          error:
            "권한 문제로 접수를 저장할 수 없습니다. 다시 로그인해주세요. (오류 코드: AUTH_MISMATCH)",
        };
      }

      const fallbackResult = await upsertWithColumnFallback(adminDb, {
        ...submissionPayload,
        user_id: user?.id ?? null,
      });
      const fallbackError = fallbackResult.error;

      if (fallbackError) {
        console.error("Submission upsert failed", fallbackError);
        return { error: formatSubmissionError(fallbackError) };
      }

      db = adminDb;
      submissionError = null;
    } else {
      console.error("Submission upsert failed", submissionError);
      return { error: formatSubmissionError(submissionError) };
    }
  }

  if (submissionError) {
    console.error("Submission upsert failed", submissionError);
    return { error: formatSubmissionError(submissionError) };
  }

  await db
    .from("album_tracks")
    .delete()
    .eq("submission_id", parsed.data.submissionId);

  const trackRows =
    parsed.data.tracks?.map((track, index) => ({
      submission_id: parsed.data.submissionId,
      track_no: index + 1,
      track_title: track.trackTitle?.trim() || null,
      track_title_kr: track.trackTitleKr?.trim() || null,
      track_title_en: track.trackTitleEn?.trim() || null,
      track_title_official: track.trackTitleOfficial || null,
      featuring: track.featuring?.trim() || null,
      composer: track.composer?.trim() || null,
      lyricist: track.lyricist?.trim() || null,
      arranger: track.arranger?.trim() || null,
      lyrics: track.lyrics?.trim() || null,
      notes: track.notes || null,
      is_title: Boolean(track.isTitle),
      title_role: track.titleRole || null,
      broadcast_selected: Boolean(track.broadcastSelected),
    })) ?? [];

  if (isSubmitted && !isOneClick) {
    if (trackRows.length === 0) {
      return { error: "트랙 정보를 입력해주세요." };
    }
    if (trackRows.some((track) => !track.track_title)) {
      return { error: "모든 트랙의 곡명을 입력해주세요." };
    }
    if (trackRows.some((track) => !track.composer)) {
      return { error: "모든 트랙의 작곡 정보를 입력해주세요." };
    }
  }

  if (trackRows.length > 0) {
    const trackResult = await insertWithColumnFallback(
      db,
      "album_tracks",
      trackRows,
    );
    const trackError = trackResult.error;

    if (trackError) {
      return { error: "트랙 정보를 저장할 수 없습니다." };
    }
  }

  if (parsed.data.files !== undefined) {
    await db
      .from("submission_files")
      .delete()
      .eq("submission_id", parsed.data.submissionId)
      .eq("kind", "AUDIO");

    const fileRows =
      parsed.data.files?.map((file) => ({
        submission_id: parsed.data.submissionId,
        kind: "AUDIO",
        file_path: file.path,
        object_key: file.path,
        storage_provider: "b2",
        status: "UPLOADED",
        uploaded_at: new Date().toISOString(),
        original_name: file.originalName,
        mime: file.mime || null,
        size: file.size,
        checksum: file.checksum ?? null,
        duration_seconds: file.durationSeconds ?? null,
        access_url: file.accessUrl ?? null,
      })) ?? [];

    if (fileRows.length > 0) {
      const fileResult = await insertWithColumnFallback(
        db,
        "submission_files",
        fileRows,
      );
      const fileError = fileResult.error;

      if (fileError) {
        return { error: "파일 정보를 저장할 수 없습니다." };
      }
    }
  }

  if (parsed.data.status === "SUBMITTED") {
    const selectedStationIds = Array.from(
      new Set(parsed.data.selectedStationIds ?? []),
    ).filter(Boolean);
    let stationIds = selectedStationIds;
    let missingCodes: string[] = [];

    if (stationIds.length === 0) {
      const resolved = await resolveAlbumStationIds(
        db,
        parsed.data.packageId,
      );
      stationIds = resolved.stationIds;
      missingCodes = resolved.missingCodes;
    }

    if (stationIds.length === 0) {
      const { data: packageStations, error: stationError } = await db
        .from("package_stations")
        .select("station_id")
        .eq("package_id", parsed.data.packageId);

      if (stationError) {
        console.warn("Failed to load package stations", stationError);
      } else {
        stationIds =
          packageStations
            ?.map((station) => station.station_id)
            .filter((id): id is string => Boolean(id)) ?? [];
      }
    }

    if (stationIds.length === 0) {
      console.warn("No stations resolved for album submission", {
        submissionId: parsed.data.submissionId,
        packageId: parsed.data.packageId,
        missingCodes,
      });
    }

    if (missingCodes.length > 0) {
      console.warn("Missing station codes for package", {
        submissionId: parsed.data.submissionId,
        packageId: parsed.data.packageId,
        missingCodes,
      });
    }

    if (stationIds.length > 0) {
      const { error: reviewError } = await ensureStationReviews(
        db,
        parsed.data.submissionId,
        stationIds,
      );

      if (reviewError) {
        return { error: "방송국 진행 정보를 저장할 수 없습니다." };
      }
    }

    await ensureAlbumStationReviews(
      db,
      parsed.data.submissionId,
      packageStationCount,
      packageName,
    );
  }

  const eventMessage =
    parsed.data.status === "SUBMITTED"
      ? shouldRequestPayment
        ? paymentMethod === "CARD"
          ? "카드 결제 요청이 접수되었습니다."
          : "입금 확인 요청이 접수되었습니다."
        : "심의 접수가 완료되었습니다."
      : "임시 저장이 완료되었습니다.";

  await db.from("submission_events").insert({
    submission_id: parsed.data.submissionId,
    actor_user_id: user?.id ?? null,
    event_type: parsed.data.status,
    message: eventMessage,
  });

  let emailWarning: string | undefined;
  if (parsed.data.status === "SUBMITTED") {
    const recipientEmail =
      applicantEmailValue || guestEmailValue || user?.email || null;
    if (recipientEmail) {
      const link =
        parsed.data.guestToken && parsed.data.guestToken.length >= 8
          ? `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/track/${parsed.data.guestToken}`
          : undefined;
      const emailResult = await sendSubmissionReceiptEmail({
        email: recipientEmail,
        title: titleValue || "제목 미입력",
        kind: "ALBUM",
        isGuest: isGuest,
        guestToken: parsed.data.guestToken ?? undefined,
        link,
      });
      if (emailResult.skipped) {
        console.warn("[Email][receipt] skipped (config missing)", {
          submissionId: parsed.data.submissionId,
          email: recipientEmail,
        });
      } else if (!emailResult.ok) {
        emailWarning =
          emailResult.message ??
          "접수 완료 메일을 보내지 못했습니다. 관리자에게 문의해주세요.";
      }
    }
  }

  return {
    submissionId: parsed.data.submissionId,
    guestToken: isGuest ? parsed.data.guestToken : undefined,
    emailWarning: typeof emailWarning === "string" ? emailWarning : undefined,
  };
}

export async function saveMvSubmissionAction(
  payload: z.infer<typeof mvSubmissionSchema>,
): Promise<SubmissionActionState> {
  const parsed = mvSubmissionSchema.safeParse(payload);

  if (!parsed.success) {
    return { error: "입력값을 다시 확인해주세요." };
  }

  const supabase = await createServerSupabase();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError && !isMissingSessionError(userError)) {
    return { error: "로그인 정보를 확인할 수 없습니다." };
  }

  const isGuest = !user;
  const isSubmitted = parsed.data.status === "SUBMITTED";
  const titleValue = parsed.data.title?.trim() ?? "";
  const artistNameValue = parsed.data.artistName?.trim() ?? "";
  const guestNameValue = parsed.data.guestName?.trim() ?? "";
  const guestEmailValue = parsed.data.guestEmail?.trim() ?? "";
  const guestPhoneValue = parsed.data.guestPhone?.trim() ?? "";
  const applicantEmailValue = parsed.data.applicantEmail?.trim() ?? "";
  const bankDepositorNameValue = parsed.data.bankDepositorName?.trim() ?? "";

  if (isGuest && !parsed.data.guestToken) {
    return { error: "로그인 정보를 확인할 수 없습니다." };
  }
  if (
    isSubmitted &&
    isGuest &&
    (!guestNameValue || !guestEmailValue || !guestPhoneValue)
  ) {
    return { error: "비회원 정보(담당자, 연락처, 이메일)를 입력해주세요." };
  }
  if (isSubmitted && isGuest && !isValidEmailFormat(guestEmailValue)) {
    return { error: "비회원 이메일 형식을 확인해주세요." };
  }
  if (isSubmitted && !titleValue) {
    return { error: "제목을 입력해주세요." };
  }
  if (isSubmitted && !artistNameValue) {
    return { error: "아티스트명을 입력해주세요." };
  }

  const adminDb = createAdminClient();
  let db = isGuest ? adminDb : supabase;

  let amountKrw = parsed.data.amountKrw ?? 0;
  if (isSubmitted && amountKrw <= 0) {
    return { error: "결제 금액 정보를 확인할 수 없습니다." };
  }
  amountKrw = Math.max(0, amountKrw);
  const songTitleValue =
    parsed.data.songTitle ||
    (parsed.data.songTitleOfficial === "KR"
      ? parsed.data.songTitleKr
      : parsed.data.songTitleOfficial === "EN"
        ? parsed.data.songTitleEn
        : parsed.data.songTitleKr || parsed.data.songTitleEn) ||
    null;
  const songTitleKrValue = parsed.data.songTitleKr || null;
  const songTitleEnValue = parsed.data.songTitleEn || null;

  const paymentMethod = parsed.data.paymentMethod ?? "BANK";
  if (
    isSubmitted &&
    paymentMethod === "BANK" &&
    !bankDepositorNameValue
  ) {
    return { error: "입금자명을 입력해주세요." };
  }
  if (isSubmitted && !parsed.data.artistNameOfficial?.trim()) {
    return { error: "아티스트명 공식 표기를 입력해주세요." };
  }
  if (isSubmitted && !parsed.data.lyrics?.trim()) {
    return { error: "가사를 입력해주세요." };
  }

  const shouldRequestPayment =
    isSubmitted &&
    (paymentMethod === "CARD" || Boolean(bankDepositorNameValue));
  const artistId = await ensureArtistByName(artistNameValue);

  const submissionPayload = {
    id: parsed.data.submissionId,
    user_id: user?.id ?? null,
    type: parsed.data.mvType,
    title: titleValue || null,
    artist_name: artistNameValue || null,
    artist_name_kr: parsed.data.artistNameOfficial || null,
    artist_id: artistId,
    release_date: parsed.data.releaseDate || null,
    genre: parsed.data.genre?.trim() || null,
    mv_runtime: parsed.data.runtime?.trim() || null,
    mv_format: parsed.data.format?.trim() || null,
    mv_director: parsed.data.director?.trim() || null,
    mv_lead_actor: parsed.data.leadActor?.trim() || null,
    mv_storyline: parsed.data.storyline?.trim() || null,
    mv_production_company: parsed.data.productionCompany?.trim() || null,
    mv_agency: parsed.data.agency?.trim() || null,
    mv_album_title: parsed.data.albumTitle?.trim() || null,
    mv_production_date: parsed.data.productionDate || null,
    mv_distribution_company: parsed.data.distributionCompany?.trim() || null,
    mv_business_reg_no: parsed.data.businessRegNo?.trim() || null,
    mv_usage: parsed.data.usage?.trim() || null,
    mv_desired_rating: parsed.data.desiredRating?.trim() || null,
    mv_memo: parsed.data.memo?.trim() || null,
    mv_song_title: songTitleValue,
    mv_song_title_kr: songTitleKrValue,
    mv_song_title_en: songTitleEnValue,
    mv_song_title_official: parsed.data.songTitleOfficial || null,
    mv_composer: parsed.data.composer?.trim() || null,
    mv_lyricist: parsed.data.lyricist?.trim() || null,
    mv_arranger: parsed.data.arranger?.trim() || null,
    mv_song_memo: parsed.data.songMemo?.trim() || null,
    mv_lyrics: parsed.data.lyrics?.trim() || null,
    package_id: parsed.data.packageId ?? null,
    amount_krw: amountKrw,
    applicant_email: applicantEmailValue || null,
    mv_base_selected: parsed.data.mvBaseSelected ?? true,
    guest_name: isGuest ? guestNameValue || null : null,
    guest_company: isGuest ? parsed.data.guestCompany?.trim() || null : null,
    guest_email: isGuest ? guestEmailValue || null : null,
    guest_phone: isGuest ? guestPhoneValue || null : null,
    guest_token: isGuest ? parsed.data.guestToken : null,
    pre_review_requested: parsed.data.preReviewRequested ?? false,
    karaoke_requested: parsed.data.karaokeRequested ?? false,
    payment_method: paymentMethod,
    bank_depositor_name:
      paymentMethod === "BANK" ? bankDepositorNameValue || null : null,
    status:
      parsed.data.status === "SUBMITTED" && shouldRequestPayment
        ? "WAITING_PAYMENT"
        : parsed.data.status,
    payment_status: shouldRequestPayment ? "PAYMENT_PENDING" : "UNPAID",
  };

  let submissionError = (await upsertWithColumnFallback(db, submissionPayload))
    .error;

  if (submissionError) {
    if (db !== adminDb) {
      const { data: existingSubmission } = await adminDb
        .from("submissions")
        .select("id, user_id, guest_token")
        .eq("id", parsed.data.submissionId)
        .maybeSingle();

      if (
        existingSubmission?.user_id &&
        user &&
        existingSubmission.user_id !== user.id
      ) {
        return {
          error:
            "권한 문제로 접수를 저장할 수 없습니다. 다시 로그인해주세요. (오류 코드: AUTH_MISMATCH)",
        };
      }

      if (
        !existingSubmission?.user_id &&
        existingSubmission?.guest_token &&
        parsed.data.guestToken &&
        existingSubmission.guest_token !== parsed.data.guestToken
      ) {
        return {
          error:
            "권한 문제로 접수를 저장할 수 없습니다. 다시 로그인해주세요. (오류 코드: AUTH_MISMATCH)",
        };
      }

      const fallbackResult = await upsertWithColumnFallback(adminDb, {
        ...submissionPayload,
        user_id: user?.id ?? null,
      });
      const fallbackError = fallbackResult.error;

      if (fallbackError) {
        console.error("MV submission upsert failed", fallbackError);
        return { error: formatSubmissionError(fallbackError) };
      }

      db = adminDb;
      submissionError = null;
    } else {
      console.error("MV submission upsert failed", submissionError);
      return { error: formatSubmissionError(submissionError) };
    }
  }

  if (submissionError) {
    console.error("MV submission upsert failed", submissionError);
    return { error: formatSubmissionError(submissionError) };
  }

  if (parsed.data.files !== undefined) {
    await db
      .from("submission_files")
      .delete()
      .eq("submission_id", parsed.data.submissionId)
      .eq("kind", "VIDEO");

    const fileRows =
      parsed.data.files?.map((file) => ({
        submission_id: parsed.data.submissionId,
        kind: "VIDEO",
        file_path: file.path,
        object_key: file.path,
        storage_provider: "b2",
        status: "UPLOADED",
        uploaded_at: new Date().toISOString(),
        original_name: file.originalName,
        mime: file.mime || null,
        size: file.size,
        checksum: file.checksum ?? null,
        duration_seconds: file.durationSeconds ?? null,
        access_url: file.accessUrl ?? null,
      })) ?? [];

    if (fileRows.length > 0) {
      const fileResult = await insertWithColumnFallback(
        db,
        "submission_files",
        fileRows,
      );
      const fileError = fileResult.error;

      if (fileError) {
        return { error: "파일 정보를 저장할 수 없습니다." };
      }
    }
  }

  if (isSubmitted) {
    let stationIds = parsed.data.selectedStationIds ?? [];

    if (stationIds.length === 0 && parsed.data.packageId) {
      const { data: packageStations, error: stationError } = await db
        .from("package_stations")
        .select("station_id")
        .eq("package_id", parsed.data.packageId);

      if (stationError) {
        return { error: "방송국 정보를 불러올 수 없습니다." };
      }

      stationIds =
        packageStations
          ?.map((station) => station.station_id)
          .filter((id): id is string => Boolean(id)) ?? [];
    }

    const { error: reviewError } = await ensureStationReviews(
      db,
      parsed.data.submissionId,
      stationIds,
    );

    if (reviewError) {
      return { error: "방송국 진행 정보를 저장할 수 없습니다." };
    }
  }

  const eventMessage =
    parsed.data.status === "SUBMITTED"
      ? shouldRequestPayment
        ? paymentMethod === "CARD"
          ? "카드 결제 요청이 접수되었습니다."
          : "입금 확인 요청이 접수되었습니다."
        : "MV 심의 접수가 완료되었습니다."
      : "임시 저장이 완료되었습니다.";

  await db.from("submission_events").insert({
    submission_id: parsed.data.submissionId,
    actor_user_id: user?.id ?? null,
    event_type: parsed.data.status,
    message: eventMessage,
  });

  let emailWarning: string | undefined;
  if (parsed.data.status === "SUBMITTED") {
    const recipientEmail =
      applicantEmailValue || guestEmailValue || user?.email || null;
    if (recipientEmail) {
      const link =
        parsed.data.guestToken && parsed.data.guestToken.length >= 8
          ? `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/track/${parsed.data.guestToken}`
          : undefined;
      const emailResult = await sendSubmissionReceiptEmail({
        email: recipientEmail,
        title: titleValue || "제목 미입력",
        kind: "MV",
        isGuest: isGuest,
        guestToken: parsed.data.guestToken ?? undefined,
        link,
      });
      if (emailResult.skipped) {
        console.warn("[Email][receipt] skipped (config missing)", {
          submissionId: parsed.data.submissionId,
          email: recipientEmail,
        });
      } else if (!emailResult.ok) {
        emailWarning =
          emailResult.message ??
          "접수 완료 메일을 보내지 못했습니다. 관리자에게 문의해주세요.";
      }
    }
  }

  return {
    submissionId: parsed.data.submissionId,
    guestToken: isGuest ? parsed.data.guestToken : undefined,
    emailWarning: typeof emailWarning === "string" ? emailWarning : undefined,
  };
}
