import { createHash } from "node:crypto";
import path from "node:path";
import { REVIEW_DOC_LIMITS } from "./model";

// Lightweight upload checks. Parsing runs only after the durable queue claims it.
export class ReviewExtractionError extends Error {
  constructor(public code: string, message: string) { super(message); this.name = "ReviewExtractionError"; }
}
export function validateReviewUpload(file: { name: string; mime?: string; buffer: Buffer }) {
  const extension = path.extname(file.name).toLowerCase().slice(1);
  if (!["doc", "docx", "hwp", "pdf"].includes(extension)) throw new ReviewExtractionError("UNSUPPORTED_FORMAT", "DOC, DOCX, HWP, PDF 파일만 업로드할 수 있습니다. HWPX는 검증되지 않아 지원하지 않습니다.");
  if (!file.buffer.length || file.buffer.length > REVIEW_DOC_LIMITS.fileBytes) throw new ReviewExtractionError("FILE_SIZE", `빈 파일이거나 파일당 ${REVIEW_DOC_LIMITS.fileBytes / 1024 / 1024}MB 제한을 넘었습니다.`);
  const mimes: Record<string, string[]> = { doc: ["application/msword", "application/rtf", "text/rtf"], docx: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"], hwp: ["application/x-hwp", "application/haansofthwp", "application/vnd.hancom.hwp"], pdf: ["application/pdf"] };
  const mime = (file.mime ?? "").split(";")[0].trim().toLowerCase();
  if (mime && mime !== "application/octet-stream" && !mimes[extension].includes(mime)) throw new ReviewExtractionError("MIME_MISMATCH", "파일 확장자와 MIME 형식이 일치하지 않습니다.");
  const ole = file.buffer.subarray(0, 8).equals(Buffer.from("d0cf11e0a1b11ae1", "hex"));
  const rtf = /^\s*\{\\rtf[0-9]/.test(file.buffer.subarray(0, 40).toString("latin1"));
  if (extension === "docx" && ole && file.buffer.includes(Buffer.from("EncryptedPackage", "utf16le"))) throw new ReviewExtractionError("ENCRYPTED", "암호화된 Word DOCX입니다. 암호를 해제 후 업로드해주세요.");
  const valid = extension === "docx" ? file.buffer.subarray(0, 4).equals(Buffer.from("504b0304", "hex")) : extension === "pdf" ? file.buffer.subarray(0, 5).toString() === "%PDF-" : extension === "hwp" ? ole : ole || rtf;
  if (!valid) throw new ReviewExtractionError("SIGNATURE_MISMATCH", extension === "hwp" && file.buffer.subarray(0, 30).toString().startsWith("HWP Document File") ? "HWP 3 문서는 지원하지 않습니다. HWP 5 또는 DOCX로 저장해주세요." : "파일 확장자와 실제 시그니처가 일치하지 않거나 파일이 손상되었습니다.");
  return { extension: extension as "doc" | "docx" | "hwp" | "pdf", sha256: createHash("sha256").update(file.buffer).digest("hex") };
}
