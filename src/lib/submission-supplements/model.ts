import { z } from "zod";
import { inspectFileSignature } from "@/lib/file-signature";

export const SUPPLEMENT_MAX_BYTES = 4 * 1024 * 1024 * 1024;
export const SUPPLEMENT_PART_BYTES = 16 * 1024 * 1024;
const id = z.string().uuid();
const note = z.string().trim().max(4000);
const fileId = { fileId: id };
export const supplementActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("request"), note: note.min(1) }),
  z.object({ action: z.literal("notify"), requestId: id }),
  z.object({ action: z.literal("init"), requestId: id, filename: z.string().min(1).max(255).refine((value) => !/[\u0000-\u001f\u007f/\\]/.test(value)), mimeType: z.string().min(1).max(255), sizeBytes: z.number().int().min(1).max(SUPPLEMENT_MAX_BYTES) }),
  z.object({ action: z.literal("presign"), ...fileId, partNumbers: z.array(z.number().int().min(1).max(10000)).min(1).max(100).refine((parts) => new Set(parts).size === parts.length) }),
  z.object({ action: z.literal("complete"), ...fileId, parts: z.array(z.object({ partNumber: z.number().int().min(1).max(10000), etag: z.string().min(8).max(128).regex(/^[A-Za-z0-9+/_=-]+$/) })).min(1).max(10000).refine((parts) => new Set(parts.map((part) => part.partNumber)).size === parts.length) }),
  z.object({ action: z.literal("abort"), ...fileId }),
  z.object({ action: z.literal("recheck"), ...fileId }),
  z.object({ action: z.literal("download"), ...fileId }),
  z.object({ action: z.literal("submit"), requestId: id, note: note.optional() }),
  z.object({ action: z.literal("review"), requestId: id, decision: z.enum(["ACCEPTED", "REJECTED"]), note: note.optional() }).refine((value) => value.decision !== "REJECTED" || Boolean(value.note)),
]);

export const isSupplementFilenameAllowed = (name: string, kind: "audio" | "video") =>
  /\.(hwp|doc|docx|pdf|txt|zip)$/i.test(name) ||
  (kind === "audio" ? /\.(wav|mp3)$/i : /\.(mp4|mov|wmv|mpg|mpeg|m4v|mxf)$/i).test(name);

/** Never let a client label a document or text file as executable HTML. */
export function supplementMimeType(filename: string) {
  const mimeTypes: Record<string, string> = {
    wav: "audio/wav", mp3: "audio/mpeg", zip: "application/zip",
    hwp: "application/vnd.hancom.hwp", doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    pdf: "application/pdf", txt: "text/plain", mp4: "video/mp4", mov: "video/quicktime",
    wmv: "video/x-ms-wmv", mpg: "video/mpeg", mpeg: "video/mpeg", m4v: "video/mp4", mxf: "application/mxf",
  };
  return mimeTypes[filename.split(".").at(-1)?.toLowerCase() ?? ""] ?? "application/octet-stream";
}

/** Container signature only: codec, duration and broadcast specs need review. */
export function matchesSupplementSignature(filename: string, bytes: Uint8Array) {
  return inspectFileSignature(filename, bytes) === "matched";
}
