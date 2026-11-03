import { GetObjectCommand, HeadObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { getB2Config } from "@/lib/b2";
import { inspectFileSignature, type FileSignatureStatus } from "@/lib/file-signature";

export const UPLOAD_SIGNATURE_BYTES = 1024;
export class UploadSignatureMismatchError extends Error {
  constructor() {
    super("파일 내용과 확장자가 일치하지 않습니다. 원본 파일 형식을 확인하고 다시 선택해주세요.");
    this.name = "UploadSignatureMismatchError";
  }
}

/**
 * B2 answers 403 to every read of a stored object, HEAD included, once the
 * account's daily download-bandwidth or Class B transaction cap is reached
 * ("download bandwidth or transaction (Class B) cap exceeded"). Uploads
 * (Class A) and listings (Class C) are counted separately and keep working,
 * so a customer's upload must not fail because downloads hit a cap.
 */
export const isStorageReadRefused = (error: unknown) =>
  (error as { $metadata?: { httpStatusCode?: number } } | null)?.$metadata?.httpStatusCode === 403;

export type StoredObjectSize = { size: number; etag?: string; checkedBy: "head" | "listing" };

/** Size of a stored upload. When B2 refuses reads, a listing of the exact key
 * proves the object exists and gives its size; the key is the first entry
 * of its own prefix, so one entry is enough. */
export async function readStoredObjectSize(objectKey: string): Promise<StoredObjectSize> {
  const { client, bucket } = getB2Config();
  try {
    const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: objectKey }));
    return { size: head.ContentLength ?? 0, etag: head.ETag, checkedBy: "head" };
  } catch (error) {
    if (!isStorageReadRefused(error)) throw error;
    const listed = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: objectKey, MaxKeys: 1 }));
    const stored = listed.Contents?.find((item) => item.Key === objectKey);
    if (!stored) throw Object.assign(new Error("Uploaded object not found"), { name: "NotFound", $metadata: { httpStatusCode: 404 } });
    return { size: stored.Size ?? 0, etag: stored.ETag, checkedBy: "listing" };
  }
}

/** Range reads and stream cancellation bound retained bytes even if a storage
 * server unexpectedly ignores Range. No complete customer file is buffered.
 * "deferred": B2 refused the read (daily cap), so the container check could
 * not run; the upload is accepted on its verified size instead of failing. */
export async function verifyUploadedObjectSignature(objectKey: string, filename: string): Promise<FileSignatureStatus | "deferred"> {
  if (inspectFileSignature(filename, new Uint8Array()) === "unsupported") return "unsupported";
  const { client, bucket } = getB2Config();
  let result;
  try {
    result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: objectKey, Range: `bytes=0-${UPLOAD_SIGNATURE_BYTES - 1}` }));
  } catch (error) {
    if (isStorageReadRefused(error)) return "deferred";
    throw error;
  }
  if (!result.Body) throw new Error("Upload prefix unavailable");
  const reader = result.Body.transformToWebStream().getReader();
  const prefix = new Uint8Array(UPLOAD_SIGNATURE_BYTES);
  let length = 0;
  try {
    if (result.ContentLength !== undefined && result.ContentLength > UPLOAD_SIGNATURE_BYTES) throw new Error("Storage did not honor the bounded range");
    while (length < UPLOAD_SIGNATURE_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = value.subarray(0, UPLOAD_SIGNATURE_BYTES - length);
      prefix.set(chunk, length);
      length += chunk.length;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const status = inspectFileSignature(filename, prefix.subarray(0, length));
  if (status === "mismatch") throw new UploadSignatureMismatchError();
  return status;
}
