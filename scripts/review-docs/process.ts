import { createAdminClient } from "../../src/lib/supabase/admin";
import { processReviewJob } from "../../src/lib/review-docs/worker";
import type { ReviewJob } from "../../src/lib/review-docs/jobs-types";

async function main() {
  const [id, token] = process.argv.slice(2);
  const { data, error } = await createAdminClient().from("review_document_jobs").select("*").eq("id", id).eq("lease_token", token).gt("lease_until", new Date().toISOString()).maybeSingle();
  if (error || !data) process.exitCode = 1;
  else await processReviewJob(data as ReviewJob);
}
void main().catch(() => { console.error("[review-docs] 작업 프로세스 연결 실패"); process.exitCode = 1; });
