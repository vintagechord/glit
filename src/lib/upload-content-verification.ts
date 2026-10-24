import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getB2Config } from "@/lib/b2";
import { inspectFileSignature, type FileSignatureStatus } from "@/lib/file-signature";

export const UPLOAD_SIGNATURE_BYTES = 1024;
export class UploadSignatureMismatchError extends Error {
  constructor() {
    super("파일 내용과 확장자가 일치하지 않습니다. 원본 파일 형식을 확인하고 다시 선택해주세요.");
    this.name = "UploadSignatureMismatchError";
  }
}

/** Range reads and stream cancellation bound retained bytes even if a storage
 * server unexpectedly ignores Range. No complete customer file is buffered. */
export async function verifyUploadedObjectSignature(objectKey: string, filename: string): Promise<FileSignatureStatus> {
  if (inspectFileSignature(filename, new Uint8Array()) === "unsupported") return "unsupported";
  const { client, bucket } = getB2Config();
  const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: objectKey, Range: `bytes=0-${UPLOAD_SIGNATURE_BYTES - 1}` }));
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
