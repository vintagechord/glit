import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireAdminForApi } from "@/lib/admin/api-auth";
import { PURGE_BATCH_LIMIT, purgeCustomerFiles } from "@/lib/admin/customer-file-purge";
import { B2ConfigError } from "@/lib/b2";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const bodySchema = z.object({
  submissionIds: z.array(z.string().uuid()).min(1).max(PURGE_BATCH_LIMIT),
});

export async function POST(req: NextRequest) {
  const auth = await requireAdminForApi();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: `삭제할 신청을 1~${PURGE_BATCH_LIMIT}건씩 보내주세요.` },
      { status: 400 },
    );
  }

  try {
    const results = await purgeCustomerFiles(createAdminClient(), parsed.data.submissionIds, auth.user.id);
    return NextResponse.json({ results });
  } catch (error) {
    console.error("[admin][customer-files][purge] failed", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    const message = error instanceof B2ConfigError
      ? "파일 저장소 설정을 확인할 수 없습니다."
      : "삭제 대상을 확인하지 못했습니다. 잠시 후 다시 시도해주세요.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
