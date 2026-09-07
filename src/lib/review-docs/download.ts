import { createHash } from "node:crypto";
import { contentDispositionAttachment } from "@/lib/admin/review-docs";
import { authorizeReviewRequest, reviewError } from "./http";
import { assertJobLive, loadReviewJob } from "./jobs";
import { ReviewJobError } from "./jobs-types";
import { assertPrivateReviewBucket, assertReviewObjectKey, getReviewObject } from "./storage";

export async function downloadReviewFile(request: Request, id: string, source = false) {
  try {
    const user = await authorizeReviewRequest(request);
    const job = await loadReviewJob(id, user.id); assertJobLive(job);
    const fileId = new URL(request.url).searchParams.get("file");
    if (!source && (job.status !== "completed" || job.result_version !== job.version)) throw new ReviewJobError("현재 수정본의 생성이 완료되지 않았습니다.", 409, "RESULT_OUTDATED");
    const file = source ? job.sources.find((s) => s.id === fileId) : fileId === "zip" ? job.zip_output : job.outputs.find((o) => o.id === fileId);
    if (!file?.objectKey) throw new ReviewJobError("파일을 찾을 수 없습니다.", 404, "FILE_NOT_FOUND");
    assertReviewObjectKey(file.objectKey, user.id, job.id);
    await assertPrivateReviewBucket();
    const buffer = await getReviewObject(file.objectKey);
    if (file.sha256 !== createHash("sha256").update(buffer).digest("hex")) throw new ReviewJobError("저장된 파일 무결성 검증에 실패했습니다. 재생성해주세요.", 422, "FILE_INTEGRITY");
    const contentType = source ? "application/octet-stream" : fileId === "zip" ? "application/zip" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    return new Response(new Uint8Array(buffer), { headers: { "Content-Type": contentType, "Content-Disposition": contentDispositionAttachment(file.name.split("/").at(-1)!), "Content-Length": String(buffer.length), "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox" } });
  } catch (error) { return reviewError(error); }
}
