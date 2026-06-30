import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAdminForApi } from "@/lib/admin/api-auth";
import {
  buildMelonReviewDocSubmissionBundles,
  buildReviewDocsZip,
  buildReviewDocsZipFilename,
  contentDispositionAttachment,
  getReviewDocsErrorPayload,
} from "@/lib/admin/review-docs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const bodySchema = z.object({
  melonUrls: z.array(z.string().trim().min(1)).min(1).max(20),
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
      { error: "멜론 앨범 링크를 1개 이상 입력해주세요. 최대 20개까지 가능합니다." },
      { status: 400 },
    );
  }

  try {
    const bundles = await buildMelonReviewDocSubmissionBundles(
      parsed.data.melonUrls,
    );
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
    console.error("[review-docs][melon] generation failed", error);
    const payload = getReviewDocsErrorPayload(error);
    return NextResponse.json(payload.body, { status: payload.status });
  }
}
