"use server";

import { z } from "zod";

import { createServerSupabase } from "@/lib/supabase/server";

export type SubmissionActionState = {
  error?: string;
  submissionId?: string;
};

const trackSchema = z.object({
  trackTitle: z.string().min(1),
  featuring: z.string().optional(),
  composer: z.string().optional(),
  lyricist: z.string().optional(),
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
  packageId: z.string().uuid(),
  title: z.string().min(1),
  artistName: z.string().min(1),
  releaseDate: z.string().optional(),
  genre: z.string().optional(),
  status: z.enum(["DRAFT", "SUBMITTED"]),
  tracks: z.array(trackSchema).min(1),
  files: z.array(fileSchema).optional(),
});

export async function saveAlbumSubmissionAction(
  payload: z.infer<typeof albumSubmissionSchema>,
): Promise<SubmissionActionState> {
  const parsed = albumSubmissionSchema.safeParse(payload);

  if (!parsed.success) {
    return { error: "입력값을 다시 확인해주세요." };
  }

  const supabase = createServerSupabase();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return { error: "로그인이 필요합니다." };
  }

  const { data: selectedPackage, error: packageError } = await supabase
    .from("packages")
    .select("price_krw")
    .eq("id", parsed.data.packageId)
    .maybeSingle();

  if (packageError || !selectedPackage) {
    return { error: "패키지 정보를 확인할 수 없습니다." };
  }

  const submissionPayload = {
    id: parsed.data.submissionId,
    user_id: user.id,
    type: "ALBUM",
    title: parsed.data.title,
    artist_name: parsed.data.artistName,
    release_date: parsed.data.releaseDate || null,
    genre: parsed.data.genre || null,
    package_id: parsed.data.packageId,
    amount_krw: selectedPackage.price_krw,
    status: parsed.data.status,
    payment_status: "UNPAID",
  };

  const { error: submissionError } = await supabase
    .from("submissions")
    .upsert(submissionPayload, { onConflict: "id" });

  if (submissionError) {
    return { error: "접수 저장에 실패했습니다." };
  }

  await supabase
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
    notes: track.notes || null,
    is_title: Boolean(track.isTitle),
  }));

  const { error: trackError } = await supabase
    .from("album_tracks")
    .insert(trackRows);

  if (trackError) {
    return { error: "트랙 정보를 저장할 수 없습니다." };
  }

  await supabase
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
    const { error: fileError } = await supabase
      .from("submission_files")
      .insert(fileRows);

    if (fileError) {
      return { error: "파일 정보를 저장할 수 없습니다." };
    }
  }

  if (parsed.data.status === "SUBMITTED") {
    const { data: existingReviews } = await supabase
      .from("station_reviews")
      .select("id")
      .eq("submission_id", parsed.data.submissionId)
      .limit(1)
      .maybeSingle();

    if (!existingReviews) {
      const { data: packageStations, error: stationError } = await supabase
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

        const { error: insertStationError } = await supabase
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
      ? "심의 접수가 완료되었습니다."
      : "임시 저장이 완료되었습니다.";

  await supabase.from("submission_events").insert({
    submission_id: parsed.data.submissionId,
    actor_user_id: user.id,
    event_type: parsed.data.status,
    message: eventMessage,
  });

  return { submissionId: parsed.data.submissionId };
}
