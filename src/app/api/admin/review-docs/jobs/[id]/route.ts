import { authorizeReviewRequest, readReviewJson, reviewError, reviewJson } from "@/lib/review-docs/http";
import { changeReviewJob, loadReviewJob } from "@/lib/review-docs/jobs";
import { publicReviewJob } from "@/lib/review-docs/jobs-types";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  try { const user = await authorizeReviewRequest(request); return reviewJson({ job: publicReviewJob(await loadReviewJob((await context.params).id, user.id)) }); }
  catch (error) { return reviewError(error); }
}
export async function PATCH(request: Request, context: Context) {
  try {
    const user = await authorizeReviewRequest(request, true);
    const job = await loadReviewJob((await context.params).id, user.id);
    const body = await readReviewJson(request, 10 * 1024 * 1024);
    return reviewJson({ job: publicReviewJob(await changeReviewJob(job, user.id, "save", body?.version, body?.data)) });
  } catch (error) { return reviewError(error); }
}
