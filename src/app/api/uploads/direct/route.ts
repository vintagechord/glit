import Busboy from "busboy";
import { NextResponse } from "next/server";
import { PassThrough, Readable } from "stream";
import { ReadableStream as NodeReadableStream } from "stream/web";
import { z } from "zod";

import {
  buildObjectKey,
  deleteObject,
  getB2Config,
} from "@/lib/b2";
import {
  getGuestStorageOwnerId,
  getStorageLogId,
} from "@/lib/guest-storage-owner";
import { ensureSubmissionOwner, findSubmissionById } from "@/lib/payments/submission";
import {
  consumeRateLimit,
  getRequestIdentifier,
} from "@/lib/request-rate-limit";
import {
  isApplicationFormFile,
  isApplicationFormMime,
  isAudioUploadFile,
  isVideoUploadFile,
} from "@/lib/submission-files";
import { createServerSupabase } from "@/lib/supabase/server";
import { Upload } from "@aws-sdk/lib-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const schema = z.object({
  submissionId: z.string().uuid(),
  title: z.string().max(255).optional(),
  guestToken: z.string().min(8).max(120).optional(),
  filename: z.string().min(1).max(255),
  mimeType: z.string().max(255).optional(),
  sizeBytes: z.coerce.number().int().positive(),
});

// This route streams through the application worker and is only a small-file
// compatibility fallback. Large media must use size-bound PUT/multipart URLs.
const MAX_DIRECT_UPLOAD_BYTES = 128 * 1024 * 1024;
const MAX_MULTIPART_OVERHEAD_BYTES = 256 * 1024;
const MAX_MULTIPART_FIELDS = 16;
const MAX_MULTIPART_FIELD_BYTES = 8 * 1024;
const MAX_MULTIPART_PARTS = MAX_MULTIPART_FIELDS + 1;
const BYTE_QUOTA_UNIT = 1024 * 1024;
const SINGLE_PUT_SUBMISSION_DAILY_MIB = 4 * 1024;
const SINGLE_PUT_OWNER_DAILY_MIB = 8 * 1024;
const SINGLE_PUT_IP_DAILY_MIB = 8 * 1024;

const resultAttachmentPattern = /\.(pdf|jpg|jpeg|png|webp|txt)$/i;

const isResultAttachmentFile = (
  filename?: string | null,
  mimeType?: string | null,
) => {
  const mime = (mimeType ?? "").toLowerCase();
  return (
    resultAttachmentPattern.test(filename ?? "") ||
    mime === "application/pdf" ||
    mime === "text/plain" ||
    mime === "image/jpeg" ||
    mime === "image/png" ||
    mime === "image/webp"
  );
};

const isAllowedDirectUploadFile = (
  filename?: string | null,
  mimeType?: string | null,
) =>
  isAudioUploadFile(filename, mimeType) ||
  isVideoUploadFile(filename, mimeType) ||
  isApplicationFormFile(filename) ||
  isApplicationFormMime(mimeType) ||
  isResultAttachmentFile(filename, mimeType);

class UploadRequestError extends Error {
  status: number;
  retryAfterSeconds?: number;

  constructor(message: string, status: number, retryAfterSeconds?: number) {
    super(message);
    this.name = "UploadRequestError";
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

type DirectUploadResult = {
  objectKey: string;
  userId: string | null;
  guest: boolean;
};

type DirectUploadControl = {
  aborted: boolean;
  objectKey: string | null;
  uploader: Upload | null;
};

const ensureUploadAccess = async (
  submissionId: string,
  guestToken?: string,
) => {
  const ownership = await ensureSubmissionOwner(submissionId, guestToken);
  if (!ownership.error && ownership.submission) {
    return {
      user: ownership.user,
      submission: ownership.submission,
    };
  }
  if (ownership.error === "NOT_FOUND") {
    throw new UploadRequestError("접수를 찾을 수 없습니다.", 404);
  }
  if (ownership.error === "UNAUTHORIZED") {
    throw new UploadRequestError("로그인 또는 게스트 토큰이 필요합니다.", 401);
  }
  if (ownership.error === "FORBIDDEN") {
    const supabase = await createServerSupabase();
    const { data: isAdmin } = await supabase.rpc("is_admin");
    if (isAdmin === true) {
      const { submission, error } = await findSubmissionById(submissionId);
      if (error || !submission) {
        throw new UploadRequestError("접수를 찾을 수 없습니다.", 404);
      }
      return {
        user: ownership.user,
        submission,
      };
    }
    throw new UploadRequestError("접수에 대한 권한이 없습니다.", 403);
  }

  throw new UploadRequestError("접수에 대한 권한이 없습니다.", 403);
};

const startValidatedUpload = async (
  data: z.infer<typeof schema>,
  filePart: {
    stream: PassThrough;
    filename?: string;
    mimeType?: string;
  },
  control: DirectUploadControl,
  requestIdentifier: string,
): Promise<DirectUploadResult> => {
  try {
    const { user, submission } = await ensureUploadAccess(
      data.submissionId,
      data.guestToken,
    );

    const objectOwnerId =
      submission.user_id ??
      (submission.guest_token
        ? getGuestStorageOwnerId(submission.guest_token)
        : null) ??
      user?.id ??
      getGuestStorageOwnerId(data.guestToken ?? "new");
    const ownerIdentifier = submission.user_id
      ? `user:${submission.user_id}`
      : `guest:${getGuestStorageOwnerId(
          submission.guest_token ?? data.guestToken ?? "new",
        )}`;
    const quotaCost = Math.max(1, Math.ceil(data.sizeBytes / BYTE_QUOTA_UNIT));
    for (const quota of [
      {
        namespace: "upload-single-put-bytes-submission",
        identifier: data.submissionId,
        limit: SINGLE_PUT_SUBMISSION_DAILY_MIB,
      },
      {
        namespace: "upload-single-put-bytes-owner",
        identifier: ownerIdentifier,
        limit: SINGLE_PUT_OWNER_DAILY_MIB,
      },
      {
        namespace: "upload-single-put-bytes-ip",
        identifier: requestIdentifier,
        limit: SINGLE_PUT_IP_DAILY_MIB,
      },
    ]) {
      const result = consumeRateLimit({
        ...quota,
        cost: quotaCost,
        windowMs: 24 * 60 * 60 * 1_000,
      });
      if (!result.allowed) {
        throw new UploadRequestError(
          "단일 파일 업로드 허용량을 초과했습니다. 잠시 후 다시 시도하거나 멀티파트 업로드를 이용해주세요.",
          429,
          result.retryAfterSeconds,
        );
      }
    }

    const key = buildObjectKey({
      userId: objectOwnerId,
      submissionId: data.submissionId,
      title: data.title,
      filename: data.filename,
    });
    control.objectKey = key;

    if (control.aborted) {
      throw new UploadRequestError("파일 용량이 허용 한도를 초과했습니다.", 413);
    }

    const { client, bucket } = getB2Config();
    const uploader = new Upload({
      client,
      params: {
        Bucket: bucket,
        Key: key,
        Body: filePart.stream,
        ContentType: data.mimeType || undefined,
        ContentLength: data.sizeBytes,
      },
      leavePartsOnError: false,
    });
    control.uploader = uploader;
    if (control.aborted) {
      await uploader.abort().catch(() => undefined);
      throw new UploadRequestError("파일 용량이 허용 한도를 초과했습니다.", 413);
    }
    await uploader.done();

    return {
      objectKey: key,
      userId: user?.id ?? null,
      guest: Boolean(submission.guest_token ?? data.guestToken),
    };
  } catch (error) {
    filePart.stream.resume();
    throw error;
  }
};

export async function POST(request: Request) {
  const requestIdentifier = getRequestIdentifier(request.headers);
  const requestLimit = consumeRateLimit({
    namespace: "upload-init-ip",
    identifier: requestIdentifier,
    limit: 60,
    windowMs: 60 * 60 * 1_000,
  });
  if (!requestLimit.allowed) {
    return NextResponse.json(
      { error: "업로드 요청이 너무 많습니다. 잠시 후 다시 시도해주세요." },
      {
        status: 429,
        headers: { "Retry-After": String(requestLimit.retryAfterSeconds) },
      },
    );
  }

  const contentType = request.headers.get("content-type");
  const contentLength = request.headers.get("content-length");
  const contentLengthBytes = /^\d{1,12}$/.test(contentLength ?? "")
    ? Number(contentLength)
    : null;

  console.info("[Upload][direct] request received", {
    contentType: contentType?.split(";", 1)[0] ?? null,
    contentLengthBytes,
  });

  if (!contentType || !contentType.toLowerCase().startsWith("multipart/form-data")) {
    console.error("[Upload][direct] invalid content-type", {
      contentType: contentType?.split(";", 1)[0] ?? null,
    });
    return NextResponse.json(
      {
        error: "업로드 데이터를 읽을 수 없습니다.",
      },
      { status: 415 },
    );
  }
  if (!request.body || !contentType) {
    console.error("[Upload][direct] missing body or content-type", {
      contentType: contentType?.split(";", 1)[0] ?? null,
      contentLengthBytes,
    });
    return NextResponse.json({ error: "업로드 데이터를 읽을 수 없습니다." }, { status: 400 });
  }

  const declaredRequestBytes = Number(contentLength ?? Number.NaN);
  if (
    Number.isFinite(declaredRequestBytes) &&
    declaredRequestBytes > MAX_DIRECT_UPLOAD_BYTES + MAX_MULTIPART_OVERHEAD_BYTES
  ) {
    return NextResponse.json(
      { error: "직접 업로드는 최대 128MB까지 지원합니다." },
      { status: 413 },
    );
  }

  const fields: Record<string, string> = {};
  let parsedData: z.infer<typeof schema> | null = null;
  let uploadPromise: Promise<DirectUploadResult> | null = null;
  let parseErrorStatus: number | null = null;
  let parseErrorBody: { error: string; detail?: string } | null = null;
  let filePart:
    | {
        stream: PassThrough;
        filename?: string;
        mimeType?: string;
        sizeBytes: number;
        truncated: boolean;
      }
    | null = null;

  const uploadControl: DirectUploadControl = {
    aborted: false,
    objectKey: null,
    uploader: null,
  };

  const cleanupStartedUpload = async () => {
    uploadControl.aborted = true;
    await uploadControl.uploader?.abort().catch(() => undefined);
    await uploadPromise?.catch(() => undefined);
    if (uploadControl.objectKey) {
      await deleteObject(uploadControl.objectKey).catch(() => undefined);
    }
  };

  const busboy = Busboy({
    headers: { "content-type": contentType },
    limits: {
      files: 1,
      fileSize: MAX_DIRECT_UPLOAD_BYTES,
      fields: MAX_MULTIPART_FIELDS,
      fieldSize: MAX_MULTIPART_FIELD_BYTES,
      parts: MAX_MULTIPART_PARTS,
    },
  });
  busboy.on("field", (name, value) => {
    fields[name] = value;
    tryStartUpload();
  });

  busboy.on("file", (_name, file, info) => {
    if (filePart) {
      // Only accept the first file; drain the rest.
      file.resume();
      return;
    }
    if (!fields.submissionId || !fields.sizeBytes) {
      parseErrorStatus = 400;
      parseErrorBody = {
        error: "파일보다 업로드 정보가 먼저 전송되어야 합니다.",
      };
      file.resume();
      return;
    }

    const pass = new PassThrough();
    const nextFilePart = {
      stream: pass,
      filename: info.filename,
      mimeType: info.mimeType,
      sizeBytes: 0,
      truncated: false,
    };
    filePart = nextFilePart;
    file.on("data", (chunk: Buffer) => {
      nextFilePart.sizeBytes += chunk.length;
    });
    file.on("limit", () => {
      nextFilePart.truncated = true;
      uploadControl.aborted = true;
      parseErrorStatus = 413;
      parseErrorBody = {
        error: "직접 업로드는 최대 128MB까지 지원합니다.",
      };
      file.unpipe(pass);
      pass.destroy();
      file.resume();
      void uploadControl.uploader?.abort().catch(() => undefined);
    });
    file.pipe(pass);
    tryStartUpload();
  });

  busboy.on("filesLimit", () => {
    parseErrorStatus = 400;
    parseErrorBody = { error: "파일은 하나만 업로드할 수 있습니다." };
  });
  busboy.on("fieldsLimit", () => {
    parseErrorStatus = 400;
    parseErrorBody = { error: "업로드 필드가 너무 많습니다." };
  });
  busboy.on("partsLimit", () => {
    parseErrorStatus = 400;
    parseErrorBody = { error: "업로드 항목이 너무 많습니다." };
  });

  const parsePromise = new Promise<void>((resolve, reject) => {
    busboy.on("finish", resolve);
    busboy.on("error", (error) => {
      console.error("[Upload][direct] busboy error", {
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
      if (parseErrorStatus === null) {
        parseErrorStatus = 400;
        parseErrorBody = {
          error: "업로드 데이터를 읽을 수 없습니다.",
        };
      }
      reject(error);
    });
  });

  const tryStartUpload = () => {
    if (uploadPromise || parseErrorStatus !== null || !filePart) return;
    if (!fields.submissionId || !fields.sizeBytes) return;

    const parsed = schema.safeParse({
      submissionId: fields.submissionId,
      title: fields.title,
      guestToken: fields.guestToken,
      filename: filePart.filename || fields.filename,
      mimeType: filePart.mimeType || fields.mimeType,
      sizeBytes: fields.sizeBytes,
    });

    if (!parsed.success) {
      console.error("[Upload][direct] validation failed", {
        invalidFields: Object.keys(parsed.error.flatten().fieldErrors),
        submissionIdHash: fields.submissionId
          ? getStorageLogId(fields.submissionId)
          : null,
      });
      parseErrorStatus = 400;
      parseErrorBody = {
        error: "업로드 정보를 확인해주세요.",
      };
      filePart.stream.resume();
      return;
    }

    parsedData = parsed.data;

    if (parsed.data.sizeBytes > MAX_DIRECT_UPLOAD_BYTES) {
      parseErrorStatus = 413;
      parseErrorBody = {
        error: "직접 업로드는 최대 128MB까지 지원합니다.",
      };
      filePart.stream.resume();
      return;
    }
    if (
      !isAllowedDirectUploadFile(
        filePart.filename || parsed.data.filename,
        filePart.mimeType || parsed.data.mimeType,
      )
    ) {
      parseErrorStatus = 400;
      parseErrorBody = {
        error:
          "업로드 가능한 파일 형식이 아닙니다. 음원/영상/신청서/심의 결과 파일만 업로드할 수 있습니다.",
      };
      filePart.stream.resume();
      return;
    }

    const startedUpload = startValidatedUpload(
      parsed.data,
      filePart,
      uploadControl,
      requestIdentifier,
    );
    void startedUpload.catch(() => undefined);
    uploadPromise = startedUpload;
  };

  try {
    const webStream = request.body as unknown as NodeReadableStream;
    if (!webStream) {
      throw new Error("Request body is empty.");
    }
    Readable.fromWeb(webStream).pipe(busboy as unknown as NodeJS.WritableStream);
    await parsePromise;
  } catch (error) {
    await cleanupStartedUpload();
    console.error("[Upload][direct] multipart parse error", {
      errorName: error instanceof Error ? error.name : "UnknownError",
      contentType: contentType?.split(";", 1)[0] ?? null,
      contentLengthBytes,
    });
    return NextResponse.json(
      { error: "업로드 데이터를 읽을 수 없습니다." },
      { status: 400 },
    );
  }

  // Attempt one last time in case required fields arrived after the file began streaming.
  tryStartUpload();

  const completedFilePart = filePart as
    | {
        stream: PassThrough;
        filename?: string;
        mimeType?: string;
        sizeBytes: number;
        truncated: boolean;
      }
    | null;
  const completedParsedData = parsedData as z.infer<typeof schema> | null;
  if (completedFilePart && completedParsedData && parseErrorStatus === null) {
    if (
      completedFilePart.truncated ||
      completedFilePart.sizeBytes > MAX_DIRECT_UPLOAD_BYTES
    ) {
      parseErrorStatus = 413;
      parseErrorBody = {
        error: "직접 업로드는 최대 128MB까지 지원합니다.",
      };
    } else if (completedFilePart.sizeBytes !== completedParsedData.sizeBytes) {
      parseErrorStatus = 400;
      parseErrorBody = {
        error: "전송된 파일 크기가 요청 정보와 일치하지 않습니다.",
      };
    }
  }

  if (parseErrorStatus !== null && parseErrorBody) {
    await cleanupStartedUpload();
    return NextResponse.json(parseErrorBody, { status: parseErrorStatus });
  }

  const uploadPromiseResolved = uploadPromise;
  const missing: string[] = [];
  if (!parsedData) missing.push("fields");
  if (!filePart) missing.push("file");
  if (!uploadPromiseResolved) missing.push("upload");

  if (missing.length > 0 || !parsedData || !uploadPromiseResolved) {
    console.error("[Upload][direct] missing file or parsed data", {
      contentType: contentType?.split(";", 1)[0] ?? null,
      contentLengthBytes,
      fieldCount: Object.keys(fields).length,
      missing,
    });
    return NextResponse.json({ error: "업로드 정보를 확인해주세요.", missing }, { status: 400 });
  }

  const uploadDetails = parsedData as z.infer<typeof schema>;
  const uploadTask = uploadPromiseResolved as Promise<DirectUploadResult>;

  try {
    const uploadResult = await uploadTask;

    console.info("[Upload][direct] ok", {
      submissionIdHash: getStorageLogId(uploadDetails.submissionId),
      objectKeyId: getStorageLogId(uploadResult.objectKey),
      sizeBytes: uploadDetails.sizeBytes,
      userIdHash: uploadResult.userId
        ? getStorageLogId(uploadResult.userId)
        : null,
      guest: uploadResult.guest,
    });

    return NextResponse.json({ objectKey: uploadResult.objectKey });
  } catch (error) {
    if (error instanceof UploadRequestError) {
      return NextResponse.json(
        { error: error.message },
        {
          status: error.status,
          headers: error.retryAfterSeconds
            ? { "Retry-After": String(error.retryAfterSeconds) }
            : undefined,
        },
      );
    }
    console.error("[Upload][direct] error", {
      submissionIdHash: getStorageLogId(uploadDetails.submissionId),
      guest: Boolean(uploadDetails.guestToken),
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return NextResponse.json(
      { error: "업로드 중 오류가 발생했습니다." },
      { status: 500 },
    );
  }
}
