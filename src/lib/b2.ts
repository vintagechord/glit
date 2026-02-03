import { randomUUID } from "crypto";
import {
  S3Client,
  type S3ClientConfig,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
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
  // prefix가 비어 있어도 동작하도록 기본값을 제공해 업로드 중단을 방지
  prefix: z.string().min(1).default("submissions"),
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
    const envMap: Record<string, string> = {
      endpoint: "B2_S3_ENDPOINT",
      region: "B2_REGION",
      bucket: "B2_BUCKET",
      prefix: "B2_PREFIX",
      keyId: "B2_KEY_ID",
      applicationKey: "B2_APPLICATION_KEY",
      presignExpiresSeconds: "B2_PRESIGN_EXPIRES_SECONDS",
    };
    const missing = parsed.error.issues
      .map((err) => envMap[err.path[0] as string] ?? String(err.path[0]))
      .join(", ");
    throw new B2ConfigError(
      `Backblaze B2 설정 누락/오류: ${missing} (값은 노출하지 않음)`,
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
  const uniquePrefix = randomUUID();
  // 보안/충돌 방지를 위해 uuid는 앞에 붙이고, 사용자가 올린 원본 파일명은 그대로 유지한다.
  // 최종 object key: submissions/{userId}/{title}/{submissionId?}/{uuid}-{originalName}
  return `${prefix}${opts.userId}/${titleSegment}/${submissionPart}${uniquePrefix}-${safe}`;
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

export async function createMultipartUpload(params: {
  objectKey: string;
  contentType?: string;
}) {
  const { client, bucket } = getB2Config();
  const command = new CreateMultipartUploadCommand({
    Bucket: bucket,
    Key: params.objectKey,
    ContentType: params.contentType,
  });
  const response = await client.send(command);
  if (!response.UploadId) {
    throw new Error("multipart uploadId 생성에 실패했습니다.");
  }
  return response.UploadId;
}

export async function presignUploadPart(params: {
  objectKey: string;
  uploadId: string;
  partNumber: number;
  expiresInSeconds?: number;
}) {
  const { client, bucket, signExpiry } = getB2Config();
  const command = new UploadPartCommand({
    Bucket: bucket,
    Key: params.objectKey,
    UploadId: params.uploadId,
    PartNumber: params.partNumber,
  });
  return getSignedUrl(client, command, {
    expiresIn: params.expiresInSeconds ?? signExpiry,
  });
}

export async function completeMultipartUpload(params: {
  objectKey: string;
  uploadId: string;
  parts: Array<{ partNumber: number; etag: string }>;
}) {
  const { client, bucket } = getB2Config();
  const command = new CompleteMultipartUploadCommand({
    Bucket: bucket,
    Key: params.objectKey,
    UploadId: params.uploadId,
    MultipartUpload: {
      Parts: params.parts
        .filter((part) => part.partNumber && part.etag)
        .sort((a, b) => a.partNumber - b.partNumber)
        .map((part) => ({
          PartNumber: part.partNumber,
          ETag: part.etag,
        })),
    },
  });
  return client.send(command);
}

export async function abortMultipartUpload(params: {
  objectKey: string;
  uploadId: string;
}) {
  const { client, bucket } = getB2Config();
  const command = new AbortMultipartUploadCommand({
    Bucket: bucket,
    Key: params.objectKey,
    UploadId: params.uploadId,
  });
  return client.send(command);
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
