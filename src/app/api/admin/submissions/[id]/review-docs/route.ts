import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAdminForApi } from "@/lib/admin/api-auth";
import {
  buildReviewDocsZip,
  buildReviewDocsZipFilename,
  contentDispositionAttachment,
  getReviewDocsErrorPayload,
  loadReviewDocSubmissionBundles,
  recordReviewDocsGeneratedEvents,
} from "@/lib/admin/review-docs";
import { persistHydratedReleasedAlbums } from "@/lib/admin/released-album-hydration";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const paramsSchema = z.object({
  id: z.string().uuid(),
});

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
    const bundles = await loadReviewDocSubmissionBundles(supabase, [parsed.data.id]);
    // The documents of a released-album (URL) request come from Melon/Genie;
    // keep the same details on the submission so the admin and customer
    // application views match the generated forms.
    const zip = await buildReviewDocsZip(bundles, {
      onHydrated: (hydrated) => persistHydratedReleasedAlbums(supabase, hydrated, auth.user.id),
    });
    const filename = buildReviewDocsZipFilename(bundles);
    await recordReviewDocsGeneratedEvents({
      supabase,
      submissionIds: [parsed.data.id],
      actorUserId: auth.user.id,
      mode: "single",
    });

    return new NextResponse(new Uint8Array(zip), {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": contentDispositionAttachment(filename),
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("[review-docs] single generation failed", error);
    const payload = getReviewDocsErrorPayload(error);
    return NextResponse.json(payload.body, { status: payload.status });
  }
}
