import { createAdminClient } from "@/lib/supabase/admin";
import { getServiceRoleKey } from "@/lib/supabase/env";
import { createReviewDeskTranslateHandlers } from "@/lib/admin/review-desk-handler";
import { translateLyricsBatch } from "@/lib/server-lyrics-translation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// One batch of up to 120 lines waits for the model (the public route allows 50 s).
export const maxDuration = 60;

const handlers = createReviewDeskTranslateHandlers({
  secret: getServiceRoleKey,
  createDb: createAdminClient,
  translate: translateLyricsBatch,
});
export const POST = handlers.POST;
