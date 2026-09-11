import { authorizeReviewRequest, readReviewJson, readReviewUpload, reviewError, reviewJson } from "@/lib/review-docs/http";
import { createFileReviewJob, createUrlReviewJob, listReviewJobs } from "@/lib/review-docs/jobs";
import { publicReviewJob, REVIEW_JOB_LIMITS } from "@/lib/review-docs/jobs-types";
import { resumeWebReviewJobs } from "@/lib/review-docs/web-runner";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 900;
export async function GET(request: Request) {
  try {
    const user = await authorizeReviewRequest(request);
    const { jobs, ...processor } = await listReviewJobs(user.id, new URL(request.url).searchParams.get("refresh") === "1");
    if (processor.workerMode === "web") after(resumeWebReviewJobs);
    return reviewJson({ jobs: jobs.map(publicReviewJob), limits: REVIEW_JOB_LIMITS, ...processor });
  }
  catch (error) { return reviewError(error); }
}
export async function POST(request: Request) {
  try {
    const user = await authorizeReviewRequest(request, true);
    const result = request.headers.get("content-type")?.startsWith("multipart/form-data")
      ? await (async () => { const { files, mode } = await readReviewUpload(request); return createFileReviewJob(user.id, mode, files); })()
      : await createUrlReviewJob(user.id, await readReviewJson(request, 20000));
    after(resumeWebReviewJobs);
    return reviewJson({ job: publicReviewJob(result.job), duplicate: result.duplicate }, result.duplicate ? 200 : 202);
  } catch (error) { return reviewError(error); }
}
import { after } from "next/server";
