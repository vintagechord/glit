import type { ReviewDocumentData } from "./model";

export const REVIEW_JOB_LIMITS = {
  files: 8, fileBytes: 10 * 1024 * 1024, totalBytes: 40 * 1024 * 1024,
  urls: 8, pagesPerFile: 80, albums: 8, tracks: 100,
  activePerAdmin: 3, workerConcurrency: 1, processingSeconds: 900,
  retentionDays: 7, translationCharacters: 60_000,
} as const;

export type ReviewJobStatus = "uploading" | "queued" | "extracting" | "translating" | "needs_review" | "generating" | "validating" | "completed" | "failed" | "cancelled" | "expired";
export type ReviewJobSource = { id: string; name: string; mime?: string; size?: number; sha256?: string; objectKey?: string; url?: string };
export type ReviewJobOutput = { id: string; name: string; objectKey: string; size: number; sha256: string };
export type ReviewJob = {
  id: string; created_by: string; mode: "album" | "mv"; input_kind: "files" | "urls";
  fingerprint: string; status: ReviewJobStatus; operation: "extract" | "reextract" | "translate" | "generate";
  sources: ReviewJobSource[]; application_date: string;
  extracted_data: ReviewDocumentData | null; draft_data: ReviewDocumentData | null;
  snapshot_data: ReviewDocumentData | null; version: number; result_version: number | null;
  outputs: ReviewJobOutput[]; zip_output: ReviewJobOutput | null; template_version: string | null;
  counts: { albumCount: number; trackCount: number; docxCount: number } | null;
  validation: { structureChecked: boolean; rendered: boolean } | null;
  error_code: string | null; error_message: string | null; attempts: number; retryable: boolean;
  extraction_attempts: number;
  lease_token: string | null; lease_until: string | null; available_at: string;
  created_at: string; updated_at: string; expires_at: string;
};

export const WORKING_STATUSES = ["queued", "extracting", "translating", "generating", "validating", "uploading"];
export class ReviewJobError extends Error {
  constructor(message: string, public status = 400, public code = "INVALID_INPUT", public retryable = false) {
    super(message); this.name = "ReviewJobError";
  }
}

export function publicReviewJob(job: ReviewJob) {
  const expired = job.status === "expired" || Date.parse(job.expires_at) <= Date.now();
  return {
    id: job.id, mode: job.mode, input_kind: job.input_kind, status: expired ? "expired" as const : job.status,
    operation: job.operation, version: job.version, application_date: job.application_date,
    data: expired ? null : job.draft_data ?? job.extracted_data,
    sources: expired ? [] : job.sources.map(({ id, name, mime, size, url }) => ({ id, name, mime, size, url })),
    outputs: !expired && job.result_version === job.version && job.status === "completed"
      ? job.outputs.map(({ id, name, size }) => ({ id, name, size })) : [],
    has_zip: !expired && job.result_version === job.version && job.status === "completed" && !!job.zip_output,
    counts: job.counts, result_version: job.result_version, validation: job.validation,
    template_version: job.template_version, error_code: job.error_code, error_message: job.error_message,
    retryable: job.retryable, attempts: job.attempts,
    extraction_attempts: job.extraction_attempts,
    created_at: job.created_at, updated_at: job.updated_at, expires_at: job.expires_at,
  };
}
