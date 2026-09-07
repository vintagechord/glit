import { createHash } from "node:crypto";
import { PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getB2Config } from "@/lib/b2";
import { ReviewJobError } from "./jobs-types";

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
export async function assertPrivateReviewBucket(fetchImpl: typeof fetch = fetch) {
  const config = getB2Config();
  const authResponse = await fetchImpl("https://api.backblazeb2.com/b2api/v2/b2_authorize_account", {
    headers: { Authorization: `Basic ${Buffer.from(`${config.keyId}:${config.applicationKey}`).toString("base64")}` },
    signal: AbortSignal.timeout(15000), redirect: "error", cache: "no-store",
  });
  if (!authResponse.ok) throw new ReviewJobError("B2 비공개 저장소 확인에 실패했습니다. 키와 listBuckets 권한을 확인해주세요.", 503, "STORAGE_PRIVACY_UNVERIFIED");
  const auth = await authResponse.json();
  const api = new URL(auth.apiUrl);
  if (api.protocol !== "https:" || !/^api[0-9]*\.backblazeb2\.com$/.test(api.hostname) || api.port || api.username || api.password) {
    throw new ReviewJobError("B2 API 주소를 검증할 수 없습니다.", 503, "STORAGE_PRIVACY_UNVERIFIED");
  }
  const response = await fetchImpl(`${api.origin}/b2api/v2/b2_list_buckets`, {
    method: "POST", headers: { Authorization: auth.authorizationToken, "Content-Type": "application/json" },
    body: JSON.stringify({ accountId: auth.accountId, bucketName: privateBucket() }),
    signal: AbortSignal.timeout(15000), redirect: "error", cache: "no-store",
  });
  if (!response.ok) throw new ReviewJobError("B2 버킷 접근 설정을 확인할 수 없습니다. listBuckets 권한을 확인해주세요.", 503, "STORAGE_PRIVACY_UNVERIFIED");
  const payload = await response.json();
  const bucket = payload.buckets?.find((entry: { bucketName?: string }) => entry.bucketName === privateBucket());
  if (bucket?.bucketType !== "allPrivate") throw new ReviewJobError("심의자료는 비공개 B2 버킷(allPrivate)에만 저장할 수 있습니다. REVIEW_DOCS_B2_BUCKET 설정을 확인해주세요.", 503, "STORAGE_NOT_PRIVATE");
  return privateBucket();
}

export async function putReviewObject(key: string, data: Buffer, type: string) {
  const { client } = getB2Config();
  await client.send(new PutObjectCommand({ Bucket: privateBucket(), Key: key, Body: data, ContentType: type, CacheControl: "private, no-store" }), { abortSignal: AbortSignal.timeout(60000) });
  return { size: data.length, sha256: createHash("sha256").update(data).digest("hex") };
}
export async function getReviewObject(key: string, maximumBytes = 64 * 1024 * 1024) {
  const { client } = getB2Config();
  const object = await client.send(new GetObjectCommand({ Bucket: privateBucket(), Key: key }), { abortSignal: AbortSignal.timeout(60000) });
  if (!object.Body || (object.ContentLength ?? 0) > maximumBytes) throw new ReviewJobError("파일이 없거나 허용 크기를 초과합니다.", 422, "FILE_SIZE");
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of object.Body as AsyncIterable<Uint8Array>) {
    size += chunk.length;
    if (size > maximumBytes) throw new ReviewJobError("파일 허용 크기를 초과합니다.", 422, "FILE_SIZE");
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
export async function deleteReviewObject(key: string, owner: string, job: string) {
  assertReviewObjectKey(key, owner, job);
  const { client } = getB2Config();
  await client.send(new DeleteObjectCommand({ Bucket: privateBucket(), Key: key }), { abortSignal: AbortSignal.timeout(30000) });
}
