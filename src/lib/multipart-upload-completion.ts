import { createHash } from "node:crypto";

/** Bind the exact ETag/part-number set, independent of JSON property or order. */
export function multipartCompletionManifest(parts: Array<{ partNumber: number; etag: string }>) {
  const canonical = [...parts].sort((a, b) => a.partNumber - b.partNumber)
    .map(part => [part.partNumber, part.etag]);
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

export const isMissingUploadObject = (error: unknown) => {
  const failure = error as { name?: string; $metadata?: { httpStatusCode?: number } } | null;
  return Boolean(failure && (["NotFound", "NoSuchKey"].includes(failure.name ?? "") || failure.$metadata?.httpStatusCode === 404));
};

export class MultipartCompletionPendingError extends Error {
  constructor() {
    super("파일 저장 결과를 확인 중입니다. 같은 파일로 완료 확인을 다시 시도해주세요.");
    this.name = "MultipartCompletionPendingError";
  }
}

export class MultipartCompletionConflictError extends Error {
  constructor() {
    super("저장된 파일 정보와 완료 요청이 일치하지 않습니다.");
    this.name = "MultipartCompletionConflictError";
  }
}
