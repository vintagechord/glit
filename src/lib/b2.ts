import { randomUUID } from "crypto";
import {
  S3Client,
  type S3ClientConfig,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { z } from "zod";

export class B2ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "B2ConfigError";
  }
}

const envSchema = z.object({
  endpoint: z.string().url(),
  region: z.string().min(1),
  bucket: z.string().min(1),
  prefix: z.string().min(1),
  keyId: z.string().min(1),
  applicationKey: z.string().min(1),
  presignExpiresSeconds: z.coerce.number().int().positive().default(900),
});

let cachedConfig:
  | (z.infer<typeof envSchema> & { client: S3Client; signExpiry: number })
  | null = null;

export function getB2Config() {
  if (cachedConfig) return cachedConfig;

  const parsed = envSchema.safeParse({
    endpoint: process.env.B2_S3_ENDPOINT?.trim(),
    region: process.env.B2_REGION?.trim(),
    bucket: process.env.B2_BUCKET?.trim(),
    prefix: process.env.B2_PREFIX?.trim(),
    keyId: process.env.B2_KEY_ID?.trim(),
    applicationKey: process.env.B2_APPLICATION_KEY?.trim(),
    presignExpiresSeconds: process.env.B2_PRESIGN_EXPIRES_SECONDS?.trim(),
  });

  if (!parsed.success) {
    const missing = parsed.error.issues
      .map((err) => err.path.join("."))
      .join(", ");
    throw new B2ConfigError(
      `Backblaze B2 설정이 완료되지 않았습니다. 누락/오류 항목: ${missing}`,
    );
  }

  let { endpoint, prefix } = parsed.data;
  const { region, keyId, applicationKey } = parsed.data;

  // 혹시 모를 슬래시/공백 정리
  endpoint = endpoint.replace(/\/+$/, ""); // 끝 슬래시 제거
  prefix = prefix.trim();
  if (!prefix.endsWith("/")) {
    prefix = `${prefix}/`;
  }

  const s3Config: S3ClientConfig = {
    region,
    endpoint,
    forcePathStyle: true, // B2 S3 호환 모드에서 중요
    credentials: {
      accessKeyId: keyId,
      secretAccessKey: applicationKey,
    },
  };

  const client = new S3Client(s3Config);
  cachedConfig = {
    ...parsed.data,
    endpoint,
    prefix,
    client,
    signExpiry: parsed.data.presignExpiresSeconds,
  };
  return cachedConfig;
}

export function sanitizeFileName(name: string) {
  return name
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 120);
}

export function buildObjectKey(opts: {
  userId: string;
  submissionId?: string;
  title?: string;
  filename: string;
}) {
  const { prefix } = getB2Config();
  const safe = sanitizeFileName(opts.filename);
  const titleSegment = sanitizeFileName(opts.title?.trim() || "untitled");
  const submissionPart = opts.submissionId ? `${opts.submissionId}/` : "";
  // 최종 object key: submissions/{userId}/{submissionId?}/{uuid}-{filename}
  return `${prefix}${opts.userId}/${titleSegment}/${submissionPart}${randomUUID()}-${safe}`;
}

export async function presignPutUrl(params: {
  objectKey: string;
  contentType?: string;
}) {
  const { client, bucket, signExpiry } = getB2Config();

  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: params.objectKey,
    // ContentType은 서명에 영향을 줄 수 있어서 우선 제외해도 됨.
    // 필요하다면 프론트에서 PUT시 헤더를 아예 빼고, 여기만 세팅하는 식으로 맞추기.
    // ContentType: params.contentType,
  });

  const url = await getSignedUrl(client, command, {
    expiresIn: signExpiry,
  });
  return url;
}

export async function presignGetUrl(objectKey: string, expiresIn?: number) {
  const { client, bucket, signExpiry } = getB2Config();
  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: objectKey,
  });
  const url = await getSignedUrl(client, command, {
    expiresIn: expiresIn ?? signExpiry,
  });
  return url;
}

export async function headObject(objectKey: string) {
  const { client, bucket } = getB2Config();
  const command = new HeadObjectCommand({ Bucket: bucket, Key: objectKey });
  return client.send(command);
}
