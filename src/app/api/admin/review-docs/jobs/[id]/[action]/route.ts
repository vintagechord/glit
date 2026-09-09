import { authorizeReviewRequest, readReviewJson, reviewError, reviewJson } from "@/lib/review-docs/http";
import { changeReviewJob, loadReviewJob } from "@/lib/review-docs/jobs";
import { publicReviewJob, ReviewJobError } from "@/lib/review-docs/jobs-types";
import { resumeWebReviewJobs } from "@/lib/review-docs/web-runner";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 900;
export async function POST(request: Request, context: { params: Promise<{ id: string; action: string }> }) {
  try {
    const user = await authorizeReviewRequest(request, true);
    const { id, action } = await context.params;
    if (!["generate", "translate", "retry", "cancel"].includes(action)) throw new ReviewJobError("지원하지 않는 작업입니다.", 404);
    const job = await loadReviewJob(id, user.id);
    const body = await readReviewJson(request, 1024);
    const result = await changeReviewJob(job, user.id, action, body?.version);
    if (action !== "cancel") after(resumeWebReviewJobs);
    return reviewJson({ job: publicReviewJob(result) }, 202);
  } catch (error) { return reviewError(error); }
}
import { after } from "next/server";
