import Busboy from "busboy";
import { NextResponse } from "next/server";
import { PassThrough, Readable } from "stream";
import { ReadableStream as NodeReadableStream } from "stream/web";
import { z } from "zod";

import { B2ConfigError, buildObjectKey, getB2Config } from "@/lib/b2";
import { ensureSubmissionOwner, findSubmissionById } from "@/lib/payments/submission";
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
  title: z.string().optional(),
  guestToken: z.string().min(8).optional(),
  filename: z.string().min(1),
  mimeType: z.string().optional(),
  sizeBytes: z.coerce.number().int().positive(),
});

const MAX_AUDIO_BYTES = 4 * 1024 * 1024 * 1024; // 4GB
const MAX_VIDEO_BYTES = 4 * 1024 * 1024 * 1024; // 4GB

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

  constructor(message: string, status: number) {
    super(message);
    this.name = "UploadRequestError";
    this.status = status;
  }
}

type DirectUploadResult = {
  objectKey: string;
  userId: string | null;
  guest: boolean;
};

const isVideoLike = (mime?: string | null, filename?: string | null) => {
  const lowerMime = (mime || "").toLowerCase();
  const lowerName = (filename || "").toLowerCase();
  if (lowerMime.startsWith("video/")) return true;
  return /\.(mp4|mov|mkv|webm|avi|wmv|m4v|mpg|mpeg)$/.test(lowerName);
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
): Promise<DirectUploadResult> => {
  try {
    const { user, submission } = await ensureUploadAccess(
      data.submissionId,
      data.guestToken,
    );

    const objectOwnerId =
      submission.user_id ??
      (submission.guest_token ? `guest-${submission.guest_token}` : null) ??
      user?.id ??
      `guest-${data.guestToken ?? "new"}`;

    const key = buildObjectKey({
      userId: objectOwnerId,
      submissionId: data.submissionId,
      title: data.title,
      filename: data.filename,
    });

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
  const contentType = request.headers.get("content-type");
  const contentLength = request.headers.get("content-length");
  const userAgent = request.headers.get("user-agent");
  const forwardedFor = request.headers.get("x-forwarded-for");

  console.info("[Upload][direct] request received", {
    contentType,
    contentLength,
    userAgent,
    forwardedFor,
  });

  if (!contentType || !contentType.toLowerCase().startsWith("multipart/form-data")) {
    console.error("[Upload][direct] invalid content-type", { contentType });
    return NextResponse.json(
      {
        error: "업로드 데이터를 읽을 수 없습니다.",
        detail: "지원되지 않는 Content-Type",
        receivedContentType: contentType,
      },
      { status: 415 },
    );
  }
  if (!request.body || !contentType) {
    console.error("[Upload][direct] missing body or content-type", {
      contentType,
      contentLength,
    });
    return NextResponse.json({ error: "업로드 데이터를 읽을 수 없습니다." }, { status: 400 });
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
      }
    | null = null;

  const busboy = Busboy({ headers: { "content-type": contentType } });
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

    const pass = new PassThrough();
    file.pipe(pass);
    filePart = {
      stream: pass,
      filename: info.filename,
      mimeType: info.mimeType,
    };
    tryStartUpload();
  });

  const parsePromise = new Promise<void>((resolve, reject) => {
    busboy.on("finish", resolve);
    busboy.on("error", (error) => {
      console.error("[Upload][direct] busboy error", {
        message: error instanceof Error ? error.message : String(error),
      });
      if (parseErrorStatus === null) {
        parseErrorStatus = 400;
        parseErrorBody = {
          error: "업로드 데이터를 읽을 수 없습니다.",
          detail: error instanceof Error ? error.message : String(error),
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
        errors: parsed.error.flatten().fieldErrors,
        submissionId: fields.submissionId,
        filename: filePart.filename ?? fields.filename,
        mimeType: filePart.mimeType ?? fields.mimeType,
        sizeBytes: fields.sizeBytes,
      });
      parseErrorStatus = 400;
      parseErrorBody = {
        error: "업로드 정보를 확인해주세요.",
        detail: parsed.error.message,
      };
      filePart.stream.resume();
      return;
    }

    parsedData = parsed.data;

    const videoLike = isVideoLike(
      filePart.mimeType || parsed.data.mimeType,
      filePart.filename || parsed.data.filename,
    );
    const maxSizeBytes = videoLike ? MAX_VIDEO_BYTES : MAX_AUDIO_BYTES;
    if (parsed.data.sizeBytes > maxSizeBytes) {
      parseErrorStatus = 400;
      parseErrorBody = {
        error: "파일 용량이 허용 한도(4GB)를 초과했습니다.",
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

    uploadPromise = startValidatedUpload(parsed.data, filePart);
  };

  try {
    const webStream = request.body as unknown as NodeReadableStream;
    if (!webStream) {
      throw new Error("Request body is empty.");
    }
    Readable.fromWeb(webStream).pipe(busboy as unknown as NodeJS.WritableStream);
    await parsePromise;
  } catch (error) {
    console.error("[Upload][direct] multipart parse error", {
      message: error instanceof Error ? error.message : String(error),
      contentType,
      contentLength,
    });
    return NextResponse.json(
      { error: "업로드 데이터를 읽을 수 없습니다.", detail: String(error) },
      { status: 400 },
    );
  }

  // Attempt one last time in case required fields arrived after the file began streaming.
  tryStartUpload();

  if (parseErrorStatus !== null && parseErrorBody) {
    return NextResponse.json(parseErrorBody, { status: parseErrorStatus });
  }

  const uploadPromiseResolved = uploadPromise;
  const missing: string[] = [];
  if (!parsedData) missing.push("fields");
  if (!filePart) missing.push("file");
  if (!uploadPromiseResolved) missing.push("upload");

  if (missing.length > 0 || !parsedData || !uploadPromiseResolved) {
    console.error("[Upload][direct] missing file or parsed data", {
      contentType,
      contentLength,
      fieldNames: Object.keys(fields),
      missing,
    });
    return NextResponse.json({ error: "업로드 정보를 확인해주세요.", missing }, { status: 400 });
  }

  const uploadDetails = parsedData as z.infer<typeof schema>;
  const uploadTask = uploadPromiseResolved as Promise<DirectUploadResult>;

  try {
    const uploadResult = await uploadTask;

    console.info("[Upload][direct] ok", {
      submissionId: uploadDetails.submissionId,
      objectKey: uploadResult.objectKey,
      sizeBytes: uploadDetails.sizeBytes,
      user: uploadResult.userId,
      guest: uploadResult.guest,
    });

    return NextResponse.json({ objectKey: uploadResult.objectKey });
  } catch (error) {
    if (error instanceof UploadRequestError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message =
      error instanceof B2ConfigError
        ? error.message
        : error instanceof Error
          ? error.message
          : "업로드 중 오류가 발생했습니다.";
    console.error("[Upload][direct] error", {
      submissionId: uploadDetails.submissionId,
      guest: Boolean(uploadDetails.guestToken),
      message,
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
