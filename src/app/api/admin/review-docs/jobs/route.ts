import { authorizeReviewRequest, readReviewJson, readReviewUpload, reviewError, reviewJson } from "@/lib/review-docs/http";
import { createFileReviewJob, createUrlReviewJob, listReviewJobs } from "@/lib/review-docs/jobs";
import { publicReviewJob, REVIEW_JOB_LIMITS } from "@/lib/review-docs/jobs-types";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;
export async function GET(request: Request) {
  try { const user = await authorizeReviewRequest(request); const result = await listReviewJobs(user.id); return reviewJson({ jobs: result.jobs.map(publicReviewJob), limits: REVIEW_JOB_LIMITS, workerReady: result.workerReady }); }
  catch (error) { return reviewError(error); }
}
export async function POST(request: Request) {
  try {
    const user = await authorizeReviewRequest(request, true);
    const result = request.headers.get("content-type")?.startsWith("multipart/form-data")
      ? await (async () => { const { files, mode } = await readReviewUpload(request); return createFileReviewJob(user.id, mode, files); })()
      : await createUrlReviewJob(user.id, await readReviewJson(request, 20000));
    return reviewJson({ job: publicReviewJob(result.job), duplicate: result.duplicate }, result.duplicate ? 200 : 202);
  } catch (error) { return reviewError(error); }
}
