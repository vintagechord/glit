import { randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkReviewTemplates } from "../../../scripts/review-docs/preflight";
import { ReviewJobError } from "./jobs-types";

export type ReviewProcessor = { workerReady: boolean; workerMode: "dedicated" | "web" | "unavailable"; supportedFormats: string[]; workerError?: string };
type Readiness = { expires: number; promise: Promise<{ ready: boolean; message?: string }> };
let readiness: Readiness | undefined;
export const isReviewWebEnabled = () => process.env.REVIEW_DOCS_WEB_DISABLED !== "true";

async function webReadiness() {
  if (readiness && readiness.expires > Date.now()) return readiness.promise;
  const promise = (async () => {
    try {
      await checkReviewTemplates();
      // This RPC mode is read-only: no lease, heartbeat, cleanup or job mutation.
      const { error } = await createAdminClient().rpc("claim_review_document_web_job", { p_token: randomUUID(), p_check_only: true }).abortSignal(AbortSignal.timeout(10_000));
      if (error) return { ready: false, message: ["PGRST202", "42883"].includes(error.code)
        ? "심의자료 자동 처리 설정을 적용해야 합니다. 데이터베이스 마이그레이션 0103을 적용해주세요."
        : "자동 처리 저장소에 연결할 수 없습니다. 잠시 후 연결 상태를 다시 확인합니다." };
      return { ready: true };
    } catch { return { ready: false, message: "자동 처리 환경을 확인할 수 없습니다. 서버의 DOCX 템플릿과 데이터베이스 연결을 확인해주세요." }; }
  })();
  readiness = { expires: Date.now() + 15_000, promise };
  return promise;
}

export async function reviewProcessor(dedicatedReady: boolean): Promise<ReviewProcessor> {
  if (dedicatedReady) return { workerReady: true, workerMode: "dedicated", supportedFormats: ["doc", "docx", "hwp", "pdf"] };
  if (isReviewWebEnabled()) {
    const state = await webReadiness();
    if (state.ready) return { workerReady: true, workerMode: "web", supportedFormats: ["docx"] };
    return { workerReady: false, workerMode: "unavailable", supportedFormats: [], workerError: state.message };
  }
  return { workerReady: false, workerMode: "unavailable", supportedFormats: [], workerError: "문서 처리 연결을 확인하고 있습니다. 연결이 복구되면 자동으로 시작할 수 있습니다." };
}

export function assertReviewFormats(processor: ReviewProcessor, names: string[] = []) {
  if (!processor.workerReady) throw new ReviewJobError(processor.workerError ?? "문서 처리 연결을 확인해주세요.", 503, "WORKER_UNAVAILABLE");
  if (names.some((name) => !processor.supportedFormats.includes(name.split(".").at(-1)?.toLowerCase() ?? ""))) {
    throw new ReviewJobError("현재 DOCX와 멜론·지니 URL을 바로 분석할 수 있습니다. DOC·HWP·PDF는 DOCX로 저장해 업로드하거나 전용 변환기 연결 후 다시 시도해주세요.", 422, "CONVERTER_REQUIRED");
  }
}
