import { NextResponse } from "next/server";

import { RATING_LABELS, isRatingCode } from "@/lib/mv-assets";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ensureAdmin = async () => {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: isAdmin } = await supabase.rpc("is_admin");
  return { user, isAdmin };
};

const displayText = (...values: Array<string | null | undefined>) => {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return "";
};

type MvSubmissionRow = {
  id: string;
  title: string | null;
  artist_name: string | null;
  status: string | null;
  payment_status: string | null;
  result_status: string | null;
  result_notified_at: string | null;
  updated_at: string | null;
  created_at: string | null;
  mv_desired_rating: string | null;
  mv_song_title: string | null;
  mv_album_title: string | null;
  certificate_b2_path: string | null;
  certificate_original_name: string | null;
  certificate_mime: string | null;
  certificate_size: number | null;
  certificate_uploaded_at: string | null;
};

export async function GET() {
  const { user, isAdmin } = await ensureAdmin();
  if (!user || isAdmin !== true) {
    return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("submissions")
    .select(
      [
        "id",
        "title",
        "artist_name",
        "status",
        "payment_status",
        "result_status",
        "result_notified_at",
        "updated_at",
        "created_at",
        "mv_desired_rating",
        "mv_song_title",
        "mv_album_title",
        "certificate_b2_path",
        "certificate_original_name",
        "certificate_mime",
        "certificate_size",
        "certificate_uploaded_at",
      ].join(", "),
    )
    .eq("type", "MV_DISTRIBUTION")
    .not("status", "eq", "DRAFT")
    .order("updated_at", { ascending: false })
    .limit(300);

  if (error) {
    console.error("[admin][mv-submissions] list failed", error);
    return NextResponse.json(
      { error: "뮤직비디오 접수 목록을 불러오지 못했습니다." },
      { status: 500 },
    );
  }

  const rows = (data ?? []) as unknown as MvSubmissionRow[];

  const submissions = rows.map((item) => {
    const artistName = displayText(item.artist_name);
    const albumTitle = displayText(item.mv_album_title, item.title, item.mv_song_title);
    const ratingCode = isRatingCode(item.mv_desired_rating)
      ? item.mv_desired_rating
      : null;
    return {
      id: item.id,
      label:
        artistName || albumTitle
          ? `${artistName || "아티스트 미입력"} - ${albumTitle || "앨범명 미입력"}`
          : item.id,
      artistName: artistName || null,
      albumTitle: albumTitle || null,
      status: item.status,
      paymentStatus: item.payment_status,
      resultStatus: item.result_status,
      resultNotifiedAt: item.result_notified_at,
      updatedAt: item.updated_at,
      createdAt: item.created_at,
      rating: ratingCode,
      ratingLabel: ratingCode ? RATING_LABELS[ratingCode] : null,
      certificate: item.certificate_b2_path
        ? {
            objectKey: item.certificate_b2_path,
            originalName: item.certificate_original_name,
            mimeType: item.certificate_mime,
            sizeBytes: item.certificate_size,
            uploadedAt: item.certificate_uploaded_at,
          }
        : null,
    };
  });

  return NextResponse.json({ submissions });
}
