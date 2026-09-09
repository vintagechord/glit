import { createHash } from "node:crypto";
import { PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getB2Config } from "@/lib/b2";
import { ReviewJobError } from "./jobs-types";
import { fetchWithTimeout } from "@/lib/fetch-with-timeout";
import { awaitReviewAbort } from "./abort";

// Stay inside the existing application's permitted B2 key prefix while keeping
// review jobs in their own namespace. Web and worker must share B2_PREFIX.
const reviewObjectPrefix = () => `${getB2Config().prefix}review-doc-jobs/`;
const isObjectId = (value: string) => /^[a-f0-9-]{36}$/.test(value);
export function reviewObjectKey(owner: string, job: string, file: string) {
  if (![owner, job, file].every(isObjectId)) throw new ReviewJobError("파일 식별자가 올바르지 않습니다.");
  return `${reviewObjectPrefix()}${owner}/${job}/${file}`;
}
export function assertReviewObjectKey(key: string, owner: string, job: string) {
  const prefix = `${reviewObjectPrefix()}${owner}/${job}/`;
  if (!isObjectId(owner) || !isObjectId(job) || !key.startsWith(prefix) || !isObjectId(key.slice(prefix.length))) {
    throw new ReviewJobError("이 작업에 속하지 않은 파일입니다.", 404, "FILE_NOT_FOUND");
  }
}
const privateBucket = () => process.env.REVIEW_DOCS_B2_BUCKET?.trim() || getB2Config().bucket;

/** A prefix or a boolean environment flag is not proof of bucket privacy. */
export async function assertPrivateReviewBucket(fetchImpl: typeof fetch = fetch, signal?: AbortSignal) {
  const config = getB2Config();
  const authResponse = await fetchWithTimeout("https://api.backblazeb2.com/b2api/v2/b2_authorize_account", {
    headers: { Authorization: `Basic ${Buffer.from(`${config.keyId}:${config.applicationKey}`).toString("base64")}` },
    signal, redirect: "error", cache: "no-store",
  }, 15_000, fetchImpl);
  if (!authResponse.ok) throw new ReviewJobError("B2 비공개 저장소 확인에 실패했습니다. 키와 listBuckets 권한을 확인해주세요.", 503, "STORAGE_PRIVACY_UNVERIFIED");
  const auth = await authResponse.json();
  const api = new URL(auth.apiUrl);
  if (api.protocol !== "https:" || !/^api[0-9]*\.backblazeb2\.com$/.test(api.hostname) || api.port || api.username || api.password) {
    throw new ReviewJobError("B2 API 주소를 검증할 수 없습니다.", 503, "STORAGE_PRIVACY_UNVERIFIED");
  }
  const response = await fetchWithTimeout(`${api.origin}/b2api/v2/b2_list_buckets`, {
    method: "POST", headers: { Authorization: auth.authorizationToken, "Content-Type": "application/json" },
    body: JSON.stringify({ accountId: auth.accountId, bucketName: privateBucket() }),
    signal, redirect: "error", cache: "no-store",
  }, 15_000, fetchImpl);
  if (!response.ok) throw new ReviewJobError("B2 버킷 접근 설정을 확인할 수 없습니다. listBuckets 권한을 확인해주세요.", 503, "STORAGE_PRIVACY_UNVERIFIED");
  const payload = await response.json();
  const bucket = payload.buckets?.find((entry: { bucketName?: string }) => entry.bucketName === privateBucket());
  if (bucket?.bucketType !== "allPrivate") throw new ReviewJobError("심의자료는 비공개 B2 버킷(allPrivate)에만 저장할 수 있습니다. REVIEW_DOCS_B2_BUCKET 설정을 확인해주세요.", 503, "STORAGE_NOT_PRIVATE");
  return privateBucket();
}

export async function putReviewObject(key: string, data: Buffer, type: string, signal?: AbortSignal) {
  const { client } = getB2Config();
  const deadline = AbortSignal.timeout(60_000);
  const abortSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
  abortSignal.throwIfAborted();
  await awaitReviewAbort(client.send(new PutObjectCommand({ Bucket: privateBucket(), Key: key, Body: data, ContentType: type, CacheControl: "private, no-store" }), { abortSignal }), abortSignal);
  return { size: data.length, sha256: createHash("sha256").update(data).digest("hex") };
}
export async function getReviewObject(key: string, maximumBytes = 64 * 1024 * 1024, signal?: AbortSignal) {
  const { client } = getB2Config();
  const deadline = AbortSignal.timeout(60_000);
  const abortSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
  abortSignal.throwIfAborted();
  const object = await awaitReviewAbort(client.send(new GetObjectCommand({ Bucket: privateBucket(), Key: key }), { abortSignal }), abortSignal);
  const stream = object.Body as (AsyncIterable<Uint8Array> & { destroy?: () => void }) | undefined;
  const close = () => stream?.destroy?.();
  let completed = false;
  abortSignal.addEventListener("abort", close, { once: true });
  try {
    if (!stream || (object.ContentLength ?? 0) > maximumBytes) throw new ReviewJobError("파일이 없거나 허용 크기를 초과합니다.", 422, "FILE_SIZE");
    const read = (async () => {
      const chunks: Buffer[] = []; let size = 0;
      for await (const chunk of stream) {
        abortSignal.throwIfAborted();
        size += chunk.length;
        if (size > maximumBytes) throw new ReviewJobError("파일 허용 크기를 초과합니다.", 422, "FILE_SIZE");
        chunks.push(Buffer.from(chunk));
      }
      return Buffer.concat(chunks);
    })();
    const buffer = await awaitReviewAbort(read, abortSignal);
    completed = true;
    return buffer;
  } finally {
    abortSignal.removeEventListener("abort", close);
    if (!completed) close();
  }
}
export async function deleteReviewObject(key: string, owner: string, job: string) {
  assertReviewObjectKey(key, owner, job);
  const { client } = getB2Config();
  await client.send(new DeleteObjectCommand({ Bucket: privateBucket(), Key: key }), { abortSignal: AbortSignal.timeout(30000) });
}
