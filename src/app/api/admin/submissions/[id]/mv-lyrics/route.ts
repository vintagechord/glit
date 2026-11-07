import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAdminForApi } from "@/lib/admin/api-auth";
import {
  buildMvLyricsDocument,
  contentDispositionAttachment,
  getReviewDocsErrorPayload,
  ReviewDocsNotFoundError,
} from "@/lib/admin/review-docs";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const paramsSchema = z.object({
  id: z.string().uuid(),
});

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** The 영등위 lyric Word file, made from the lyrics on the MV application. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdminForApi();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const parsed = paramsSchema.safeParse(await params);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "유효한 접수 ID가 필요합니다." },
      { status: 400 },
    );
  }

  try {
    const supabase = createAdminClient();
    const { data: submission, error } = await supabase
      .from("submissions")
      .select(
        "id, type, title, artist_name, artist_name_kr, artist_name_en, mv_song_title, mv_song_title_kr, mv_song_title_official, mv_lyrics, korean_lyrics_translation",
      )
      .eq("id", parsed.data.id)
      .maybeSingle();
    if (error) throw error;
    if (!submission) throw new ReviewDocsNotFoundError();

    const document = await buildMvLyricsDocument(submission);
    const { error: eventError } = await supabase.from("submission_events").insert({
      submission_id: parsed.data.id,
      actor_user_id: auth.user.id,
      event_type: "REVIEW_DOCS_GENERATED",
      message: "관리자가 뮤직비디오 가사 DOCX를 생성했습니다.",
    });
    if (eventError) {
      console.warn("[mv-lyrics] audit event insert skipped", { code: eventError.code });
    }

    return new NextResponse(new Uint8Array(document.buffer), {
      status: 200,
      headers: {
        "Content-Type": DOCX_MIME,
        "Content-Disposition": contentDispositionAttachment(document.filename),
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("[mv-lyrics] generation failed", error);
    const payload = getReviewDocsErrorPayload(error);
    return NextResponse.json(
      payload.status === 500 && !(error instanceof Error && "status" in error)
        ? { error: "가사 DOCX 파일을 만들 수 없습니다. 잠시 후 다시 시도해주세요." }
        : payload.body,
      { status: payload.status },
    );
  }
}
