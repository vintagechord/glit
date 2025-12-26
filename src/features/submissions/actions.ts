"use server";

import { z } from "zod";

import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabase } from "@/lib/supabase/server";

export type SubmissionActionState = {
  error?: string;
  submissionId?: string;
  guestToken?: string;
};

const trackSchema = z.object({
  trackTitle: z.string().min(1),
  featuring: z.string().optional(),
  composer: z.string().optional(),
  lyricist: z.string().optional(),
  arranger: z.string().optional(),
  lyrics: z.string().optional(),
  notes: z.string().optional(),
  isTitle: z.boolean().optional(),
});

const fileSchema = z.object({
  path: z.string().min(1),
  originalName: z.string().min(1),
  mime: z.string().optional(),
  size: z.number().int().nonnegative(),
});

const albumSubmissionSchema = z.object({
  submissionId: z.string().uuid(),
  packageId: z.string().uuid().optional(),
  amountKrw: z.number().int().nonnegative().optional(),
  selectedStationIds: z.array(z.string().uuid()).optional(),
  title: z.string().min(1),
  artistName: z.string().min(1),
  releaseDate: z.string().optional(),
  genre: z.string().optional(),
  guestToken: z.string().min(8).optional(),
  guestName: z.string().min(1).optional(),
  guestCompany: z.string().optional(),
  guestEmail: z.string().email().optional(),
  guestPhone: z.string().min(3).optional(),
  preReviewRequested: z.boolean().optional(),
  karaokeRequested: z.boolean().optional(),
  paymentMethod: z.enum(["CARD", "BANK"]).optional(),
  bankDepositorName: z.string().optional(),
  status: z.enum(["DRAFT", "SUBMITTED"]),
  tracks: z.array(trackSchema).min(1),
  files: z.array(fileSchema).optional(),
});

const mvSubmissionSchema = z.object({
  submissionId: z.string().uuid(),
  packageId: z.string().uuid().optional(),
  amountKrw: z.number().int().nonnegative(),
  selectedStationIds: z.array(z.string().uuid()).optional(),
  title: z.string().min(1),
  artistName: z.string().min(1),
  releaseDate: z.string().optional(),
  genre: z.string().optional(),
  mvType: z.enum(["MV_DISTRIBUTION", "MV_BROADCAST"]),
  runtime: z.string().optional(),
  format: z.string().optional(),
  mvBaseSelected: z.boolean().optional(),
  guestToken: z.string().min(8).optional(),
  guestName: z.string().min(1).optional(),
  guestCompany: z.string().optional(),
  guestEmail: z.string().email().optional(),
  guestPhone: z.string().min(3).optional(),
  preReviewRequested: z.boolean().optional(),
  karaokeRequested: z.boolean().optional(),
  paymentMethod: z.enum(["CARD", "BANK"]).optional(),
  bankDepositorName: z.string().optional(),
  status: z.enum(["DRAFT", "SUBMITTED"]),
  files: z.array(fileSchema).optional(),
});

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

  if (userError) {
    return { error: "로그인 정보를 확인할 수 없습니다." };
  }

  const isGuest = !user;
  if (
    isGuest &&
    (!parsed.data.guestToken ||
      !parsed.data.guestName ||
      !parsed.data.guestEmail ||
      !parsed.data.guestPhone)
  ) {
    return { error: "비회원 정보(담당자, 연락처, 이메일)를 입력해주세요." };
  }

  const db = isGuest ? createAdminClient() : supabase;

  const hasPackage = Boolean(parsed.data.packageId);
  let amountKrw = parsed.data.amountKrw ?? 0;

  if (hasPackage && parsed.data.packageId) {
    const { data: selectedPackage, error: packageError } = await db
      .from("packages")
      .select("price_krw")
      .eq("id", parsed.data.packageId)
      .maybeSingle();

    if (packageError || !selectedPackage) {
      return { error: "패키지 정보를 확인할 수 없습니다." };
    }
    amountKrw = selectedPackage.price_krw;
  }

  if (!hasPackage && amountKrw <= 0) {
    return { error: "결제 금액 정보를 확인할 수 없습니다." };
  }

  const paymentMethod = parsed.data.paymentMethod ?? "BANK";
  const isSubmitted = parsed.data.status === "SUBMITTED";
  if (
    isSubmitted &&
    paymentMethod === "BANK" &&
    !parsed.data.bankDepositorName?.trim()
  ) {
    return { error: "입금자명을 입력해주세요." };
  }
  const shouldRequestPayment =
    isSubmitted &&
    (paymentMethod === "CARD" ||
      Boolean(parsed.data.bankDepositorName?.trim()));
  const submissionPayload = {
    id: parsed.data.submissionId,
    user_id: user?.id ?? null,
    type: "ALBUM",
    title: parsed.data.title,
    artist_name: parsed.data.artistName,
    release_date: parsed.data.releaseDate || null,
    genre: parsed.data.genre || null,
    package_id: parsed.data.packageId,
    amount_krw: amountKrw,
    guest_name: isGuest ? parsed.data.guestName : null,
    guest_company: isGuest ? parsed.data.guestCompany ?? null : null,
    guest_email: isGuest ? parsed.data.guestEmail : null,
    guest_phone: isGuest ? parsed.data.guestPhone : null,
    guest_token: isGuest ? parsed.data.guestToken : null,
    pre_review_requested: parsed.data.preReviewRequested ?? false,
    karaoke_requested: parsed.data.karaokeRequested ?? false,
    payment_method: paymentMethod,
    bank_depositor_name:
      paymentMethod === "BANK" ? parsed.data.bankDepositorName || null : null,
    status:
      parsed.data.status === "SUBMITTED" && shouldRequestPayment
        ? "WAITING_PAYMENT"
        : parsed.data.status,
    payment_status: shouldRequestPayment ? "PAYMENT_PENDING" : "UNPAID",
  };

  const { error: submissionError } = await db
    .from("submissions")
    .upsert(submissionPayload, { onConflict: "id" });

  if (submissionError) {
    return { error: "접수 저장에 실패했습니다." };
  }

  await db
    .from("album_tracks")
    .delete()
    .eq("submission_id", parsed.data.submissionId);

  const trackRows = parsed.data.tracks.map((track, index) => ({
    submission_id: parsed.data.submissionId,
    track_no: index + 1,
    track_title: track.trackTitle,
    featuring: track.featuring || null,
    composer: track.composer || null,
    lyricist: track.lyricist || null,
    arranger: track.arranger || null,
    lyrics: track.lyrics || null,
    notes: track.notes || null,
    is_title: Boolean(track.isTitle),
  }));

  const { error: trackError } = await db
    .from("album_tracks")
    .insert(trackRows);

  if (trackError) {
    return { error: "트랙 정보를 저장할 수 없습니다." };
  }

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
      original_name: file.originalName,
      mime: file.mime || null,
      size: file.size,
    })) ?? [];

  if (fileRows.length > 0) {
    const { error: fileError } = await db
      .from("submission_files")
      .insert(fileRows);

    if (fileError) {
      return { error: "파일 정보를 저장할 수 없습니다." };
    }
  }

  if (parsed.data.status === "SUBMITTED") {
    const { data: existingReviews } = await db
      .from("station_reviews")
      .select("id")
      .eq("submission_id", parsed.data.submissionId)
      .limit(1)
      .maybeSingle();

    if (!existingReviews) {
      const { data: packageStations, error: stationError } = await db
        .from("package_stations")
        .select("station_id")
        .eq("package_id", parsed.data.packageId);

      if (stationError) {
        return { error: "방송국 정보를 불러올 수 없습니다." };
      }

      if (packageStations && packageStations.length > 0) {
        const stationRows = packageStations.map((station) => ({
          submission_id: parsed.data.submissionId,
          station_id: station.station_id,
          status: "NOT_SENT",
        }));

        const { error: insertStationError } = await db
          .from("station_reviews")
          .insert(stationRows);

        if (insertStationError) {
          return { error: "방송국 진행 정보를 저장할 수 없습니다." };
        }
      }
    }
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

  return {
    submissionId: parsed.data.submissionId,
    guestToken: isGuest ? parsed.data.guestToken : undefined,
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

  if (userError) {
    return { error: "로그인 정보를 확인할 수 없습니다." };
  }

  const isGuest = !user;
  if (
    isGuest &&
    (!parsed.data.guestToken ||
      !parsed.data.guestName ||
      !parsed.data.guestEmail ||
      !parsed.data.guestPhone)
  ) {
    return { error: "비회원 정보(담당자, 연락처, 이메일)를 입력해주세요." };
  }

  const db = isGuest ? createAdminClient() : supabase;

  const amountKrw = parsed.data.amountKrw ?? 0;
  if (amountKrw <= 0) {
    return { error: "결제 금액 정보를 확인할 수 없습니다." };
  }

  const paymentMethod = parsed.data.paymentMethod ?? "BANK";
  const isSubmitted = parsed.data.status === "SUBMITTED";
  if (
    isSubmitted &&
    paymentMethod === "BANK" &&
    !parsed.data.bankDepositorName?.trim()
  ) {
    return { error: "입금자명을 입력해주세요." };
  }

  const shouldRequestPayment =
    isSubmitted &&
    (paymentMethod === "CARD" ||
      Boolean(parsed.data.bankDepositorName?.trim()));
  const submissionPayload = {
    id: parsed.data.submissionId,
    user_id: user?.id ?? null,
    type: parsed.data.mvType,
    title: parsed.data.title,
    artist_name: parsed.data.artistName,
    release_date: parsed.data.releaseDate || null,
    genre: parsed.data.genre || null,
    mv_runtime: parsed.data.runtime || null,
    mv_format: parsed.data.format || null,
    package_id: parsed.data.packageId ?? null,
    amount_krw: amountKrw,
    mv_base_selected: parsed.data.mvBaseSelected ?? true,
    guest_name: isGuest ? parsed.data.guestName : null,
    guest_company: isGuest ? parsed.data.guestCompany ?? null : null,
    guest_email: isGuest ? parsed.data.guestEmail : null,
    guest_phone: isGuest ? parsed.data.guestPhone : null,
    guest_token: isGuest ? parsed.data.guestToken : null,
    pre_review_requested: parsed.data.preReviewRequested ?? false,
    karaoke_requested: parsed.data.karaokeRequested ?? false,
    payment_method: paymentMethod,
    bank_depositor_name:
      paymentMethod === "BANK" ? parsed.data.bankDepositorName || null : null,
    status:
      parsed.data.status === "SUBMITTED" && shouldRequestPayment
        ? "WAITING_PAYMENT"
        : parsed.data.status,
    payment_status: shouldRequestPayment ? "PAYMENT_PENDING" : "UNPAID",
  };

  const { error: submissionError } = await db
    .from("submissions")
    .upsert(submissionPayload, { onConflict: "id" });

  if (submissionError) {
    return { error: "접수 저장에 실패했습니다." };
  }

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
      original_name: file.originalName,
      mime: file.mime || null,
      size: file.size,
    })) ?? [];

  if (fileRows.length > 0) {
    const { error: fileError } = await db
      .from("submission_files")
      .insert(fileRows);

    if (fileError) {
      return { error: "파일 정보를 저장할 수 없습니다." };
    }
  }

  if (parsed.data.status === "SUBMITTED") {
    const { data: existingReviews } = await db
      .from("station_reviews")
      .select("id")
      .eq("submission_id", parsed.data.submissionId)
      .limit(1)
      .maybeSingle();

    if (!existingReviews) {
      const selectedStations = parsed.data.selectedStationIds ?? [];
      if (selectedStations.length > 0) {
        const stationRows = selectedStations.map((stationId) => ({
          submission_id: parsed.data.submissionId,
          station_id: stationId,
          status: "NOT_SENT",
        }));

        const { error: insertStationError } = await db
          .from("station_reviews")
          .insert(stationRows);

        if (insertStationError) {
          return { error: "방송국 진행 정보를 저장할 수 없습니다." };
        }
      } else if (parsed.data.packageId) {
        const { data: packageStations, error: stationError } = await db
          .from("package_stations")
          .select("station_id")
          .eq("package_id", parsed.data.packageId);

        if (stationError) {
          return { error: "방송국 정보를 불러올 수 없습니다." };
        }

        if (packageStations && packageStations.length > 0) {
          const stationRows = packageStations.map((station) => ({
            submission_id: parsed.data.submissionId,
            station_id: station.station_id,
            status: "NOT_SENT",
          }));

          const { error: insertStationError } = await db
            .from("station_reviews")
            .insert(stationRows);

          if (insertStationError) {
            return { error: "방송국 진행 정보를 저장할 수 없습니다." };
          }
        }
      }
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

  return {
    submissionId: parsed.data.submissionId,
    guestToken: isGuest ? parsed.data.guestToken : undefined,
  };
}
