import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import PizZip from "pizzip";
import { REVIEW_DOC_TEMPLATE_FILES } from "../../src/lib/admin/review-docs";
import { createAdminClient } from "../../src/lib/supabase/admin";
import { assertPrivateReviewBucket } from "../../src/lib/review-docs/storage";

const messages = {
  INVALID_ARGUMENTS: "허용 명령은 review-docs:worker 또는 review-docs:worker -- --check입니다.",
  CONVERTER_UNAVAILABLE: "Python 변환기를 실행할 수 없습니다. 전용 워커 이미지와 REVIEW_DOCS_PYTHON 설정을 확인해주세요.",
  PYTHON_DEPENDENCIES_UNAVAILABLE: "문서 변환 의존성이 없습니다. services/review-docs/requirements.txt로 전용 Python 환경을 다시 설치해주세요.",
  DOC_CONVERTER_UNAVAILABLE: "DOC 변환기 antiword를 설치하고 실행 권한을 확인해주세요.",
  PDF_CONVERTER_UNAVAILABLE: "PDF 변환기 poppler-utils(pdftoppm)를 설치해주세요.",
  OCR_CONVERTER_UNAVAILABLE: "스캔 문서 변환기 tesseract-ocr를 설치해주세요.",
  OCR_LANGUAGES_UNAVAILABLE: "Tesseract의 한국어·영어·일본어 언어팩(kor/eng/jpn)을 설치해주세요.",
  CONVERTER_CHECK_FAILED: "문서 변환기 사전 점검에 실패했습니다. 전용 워커 이미지를 다시 빌드해주세요.",
  TEMPLATES_UNAVAILABLE: "심의자료 DOCX 템플릿이 없거나 손상되었습니다. templates/review-docs의 8개 원본 템플릿을 복원해주세요.",
  MIGRATION_REQUIRED: "심의자료 작업 테이블이 준비되지 않았습니다. 0094 마이그레이션 적용과 서비스 역할 권한을 확인해주세요.",
  DATABASE_UNAVAILABLE: "작업 저장소에 연결할 수 없습니다. Supabase URL·서비스 역할 키·연결 상태를 확인해주세요.",
  STORAGE_UNAVAILABLE: "심의자료 저장소를 확인할 수 없습니다. B2 키·listBuckets 권한·비공개 버킷 설정을 확인해주세요.",
  STORAGE_NOT_PRIVATE: "심의자료 버킷은 비공개(allPrivate)여야 합니다. REVIEW_DOCS_B2_BUCKET 또는 B2_BUCKET을 확인해주세요.",
  PREFLIGHT_FAILED: "문서 처리 사전 점검에 실패했습니다. 전용 워커 실행 설정을 확인해주세요.",
} as const;
type PreflightCode = keyof typeof messages;

export class ReviewWorkerPreflightError extends Error {
  constructor(public readonly code: PreflightCode) {
    super(messages[code]);
    this.name = "ReviewWorkerPreflightError";
  }
}

// Return fixed messages only: subprocess/SDK errors can contain private paths or credentials.
export function safeReviewWorkerStartupError(error: unknown) {
  const safe = error instanceof ReviewWorkerPreflightError ? error : new ReviewWorkerPreflightError("PREFLIGHT_FAILED");
  return { code: safe.code, message: safe.message };
}

export function validateConverterCheckOutput(stdout: string) {
  let result: { ok?: unknown; code?: unknown };
  try { result = JSON.parse(stdout); }
  catch { throw new ReviewWorkerPreflightError("CONVERTER_CHECK_FAILED"); }
  if (result?.ok === true) return;
  const codes = ["PYTHON_DEPENDENCIES_UNAVAILABLE", "DOC_CONVERTER_UNAVAILABLE", "PDF_CONVERTER_UNAVAILABLE", "OCR_CONVERTER_UNAVAILABLE", "OCR_LANGUAGES_UNAVAILABLE", "CONVERTER_CHECK_FAILED"];
  throw new ReviewWorkerPreflightError(codes.includes(String(result?.code)) ? result.code as PreflightCode : "CONVERTER_CHECK_FAILED");
}

export async function checkReviewConverters() {
  const execute = promisify(execFile);
  let stdout: string;
  try {
    ({ stdout } = await execute(process.env.REVIEW_DOCS_PYTHON || "python3", [path.resolve("services/review-docs/check.py")], {
      timeout: 25_000, maxBuffer: 64 * 1024, encoding: "utf8",
      env: { NODE_ENV: process.env.NODE_ENV ?? "production", PATH: process.env.PATH, LANG: "C.UTF-8", PYTHONIOENCODING: "utf-8", PYTHONNOUSERSITE: "1" },
    }));
  } catch (error) {
    // Python reports expected configuration failures as a small, fixed JSON object.
    if (error && typeof error === "object" && "stdout" in error && typeof error.stdout === "string" && error.stdout) {
      validateConverterCheckOutput(error.stdout);
    }
    throw new ReviewWorkerPreflightError("CONVERTER_UNAVAILABLE");
  }
  validateConverterCheckOutput(stdout);
}

export async function checkReviewTemplates(directory = path.resolve("templates/review-docs")) {
  try {
    for (const filename of Object.values(REVIEW_DOC_TEMPLATE_FILES)) {
      const buffer = await readFile(path.join(directory, filename));
      const zip = new PizZip(buffer, { checkCRC32: true });
      if (!zip.file("[Content_Types].xml") || !zip.file("word/document.xml")?.asText().trim()) throw new Error("invalid template");
    }
  } catch { throw new ReviewWorkerPreflightError("TEMPLATES_UNAVAILABLE"); }
}

export async function checkReviewDatabase() {
  try {
    const admin = createAdminClient();
    for (const [table, columns] of [
      ["review_document_jobs", "id,status,operation,version,extraction_attempts,lease_token,lease_until,purged_at"],
      ["review_document_job_events", "id,job_id"],
      ["review_document_artifacts", "id,job_id,object_key"],
      ["review_document_worker_heartbeat", "singleton,updated_at"],
    ]) {
      // No RPC, claim, heartbeat publication, writes, or customer document reads.
      const { error } = await admin.from(table).select(columns).limit(0).abortSignal(AbortSignal.timeout(15_000));
      if (error) {
        if (["42P01", "42703", "42501", "PGRST202", "PGRST204", "PGRST205"].includes(error.code)) throw new ReviewWorkerPreflightError("MIGRATION_REQUIRED");
        throw error;
      }
    }
  } catch (error) {
    if (error instanceof ReviewWorkerPreflightError) throw error;
    throw new ReviewWorkerPreflightError("DATABASE_UNAVAILABLE");
  }
}

async function checkReviewStorage() {
  try { await assertPrivateReviewBucket(); }
  catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : null;
    throw new ReviewWorkerPreflightError(code === "STORAGE_NOT_PRIVATE" ? "STORAGE_NOT_PRIVATE" : "STORAGE_UNAVAILABLE");
  }
}

type PreflightChecks = {
  converters: () => Promise<void>;
  templates: () => Promise<void>;
  database: () => Promise<void>;
  storage: () => Promise<void>;
};

export async function checkReviewWorker(
  checks: PreflightChecks = { converters: checkReviewConverters, templates: checkReviewTemplates, database: checkReviewDatabase, storage: checkReviewStorage },
  translationConfigured = !!process.env.OPENAI_API_KEY?.trim(),
) {
  for (const check of [checks.converters, checks.templates, checks.database, checks.storage]) await check();
  return { ok: true as const, converters: true, templates: true, database: true, privateStorage: true,
    translationConfigured, warnings: translationConfigured ? [] : ["TRANSLATION_UNAVAILABLE"] };
}

export async function startCheckedReviewWorker(args: string[], options: {
  run: () => Promise<void>;
  preflight?: typeof checkReviewWorker;
  report?: (result: Awaited<ReturnType<typeof checkReviewWorker>>) => void;
}) {
  if (args.length && (args.length !== 1 || args[0] !== "--check")) throw new ReviewWorkerPreflightError("INVALID_ARGUMENTS");
  const result = await (options.preflight ?? checkReviewWorker)();
  options.report?.(result);
  // --check must stay read-only even when queued or expired jobs exist.
  if (!args.length) await options.run();
  return result;
}
