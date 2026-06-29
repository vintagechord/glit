import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAdminForApi } from "@/lib/admin/api-auth";
import {
  buildReviewDocsZip,
  buildReviewDocsZipFilename,
  contentDispositionAttachment,
  getReviewDocsErrorPayload,
  loadReviewDocSubmissionBundles,
} from "@/lib/admin/review-docs";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const bodySchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(100),
});

export async function POST(request: Request) {
  const auth = await requireAdminForApi();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "다운로드할 접수를 1건 이상 선택해주세요." },
      { status: 400 },
    );
  }

  try {
    const supabase = createAdminClient();
    const bundles = await loadReviewDocSubmissionBundles(supabase, parsed.data.ids);
    const zip = await buildReviewDocsZip(bundles);
    const filename = buildReviewDocsZipFilename(bundles);

    return new NextResponse(new Uint8Array(zip), {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": contentDispositionAttachment(filename),
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("[review-docs] bulk generation failed", error);
    const payload = getReviewDocsErrorPayload(error);
    return NextResponse.json(payload.body, { status: payload.status });
  }
}
