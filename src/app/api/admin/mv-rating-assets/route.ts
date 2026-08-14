import { PutObjectCommand } from "@aws-sdk/client-s3";
import { NextRequest, NextResponse } from "next/server";

import {
  deleteObject,
  getB2Config,
  sanitizeFileName,
} from "@/lib/b2";
import { getStorageLogId } from "@/lib/guest-storage-owner";
import {
  MANAGED_RATING_IMAGE_CODES,
  MV_RATING_IMAGE_SETTING_KEY,
  RATING_LABELS,
  isRatingCode,
  parseMvRatingImageSettings,
  resolveRatingImageUrl,
  type ManagedRatingImageCode,
  type MvRatingImageSettings,
} from "@/lib/mv-assets";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabase } from "@/lib/supabase/server";
import { getBaseUrl } from "@/lib/url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;

const isManagedRating = (value: unknown): value is ManagedRatingImageCode =>
  value === "ALL" || value === "12" || value === "15" || value === "19";

const isCustomObjectKey = (value?: string | null): value is string =>
  Boolean(value && !/^https?:\/\//i.test(value) && !value.startsWith("/"));

const normalizeUploadedFilename = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return "mv-rating-image.png";
  try {
    const decoded = Buffer.from(trimmed, "latin1").toString("utf8").trim();
    if (decoded && /[가-힣]/.test(decoded) && !/[가-힣]/.test(trimmed)) {
      return decoded;
    }
  } catch {
    // keep original
  }
  return trimmed;
};

const ensureAdmin = async () => {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: isAdmin } = await supabase.rpc("is_admin");
  return { user, isAdmin };
};

const loadSettings = async (admin: ReturnType<typeof createAdminClient>) => {
  const { data, error } = await admin
    .from("site_settings")
    .select("value")
    .eq("key", MV_RATING_IMAGE_SETTING_KEY)
    .maybeSingle();

  if (error && error.code !== "PGRST116") {
    console.warn("[admin][mv-rating-assets] settings load failed", error);
  }

  return parseMvRatingImageSettings(data?.value);
};

const saveSettings = async (
  admin: ReturnType<typeof createAdminClient>,
  settings: MvRatingImageSettings,
) => {
  const { error } = await admin.from("site_settings").upsert({
    key: MV_RATING_IMAGE_SETTING_KEY,
    value: settings,
    description: "뮤직비디오 연령등급 이미지 설정",
  });
  return error;
};

const buildAssetsPayload = async (req: NextRequest) => {
  const admin = createAdminClient();
  const baseUrl = getBaseUrl(req);
  const assets = await Promise.all(
    MANAGED_RATING_IMAGE_CODES.map(async (code) => {
      const resolved = await resolveRatingImageUrl({
        rating: code,
        db: admin,
        baseUrl,
      });
      return {
        code,
        label: RATING_LABELS[code],
        imageUrl: resolved.url,
        isCustom: resolved.isCustom,
        originalName: resolved.originalName,
        mimeType: resolved.mimeType,
        sizeBytes: resolved.sizeBytes,
        updatedAt: resolved.updatedAt,
      };
    }),
  );

  return { assets };
};

export async function GET(req: NextRequest) {
  const { user, isAdmin } = await ensureAdmin();
  if (!user || isAdmin !== true) {
    return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });
  }

  try {
    return NextResponse.json(await buildAssetsPayload(req));
  } catch (error) {
    console.error("[admin][mv-rating-assets] load failed", error);
    return NextResponse.json(
      { error: "연령등급 이미지를 불러오지 못했습니다." },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  const { user, isAdmin } = await ensureAdmin();
  if (!user || isAdmin !== true) {
    return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });
  }

  const contentType = req.headers.get("content-type");
  if (!contentType || !contentType.toLowerCase().startsWith("multipart/form-data")) {
    return NextResponse.json({ error: "multipart/form-data 형식이 아닙니다." }, { status: 415 });
  }

  const formData = await req.formData().catch((error) => {
    console.error("[admin][mv-rating-assets] form parse failed", error);
    return null;
  });
  if (!formData) {
    return NextResponse.json({ error: "업로드 데이터를 읽지 못했습니다." }, { status: 400 });
  }

  const rating = String(formData.get("rating") ?? "").trim();
  if (!isManagedRating(rating) || !isRatingCode(rating)) {
    return NextResponse.json({ error: "등급 값을 확인해주세요." }, { status: 400 });
  }

  const fileValue = formData.get("file");
  if (!(fileValue instanceof File)) {
    return NextResponse.json({ error: "파일이 포함되어 있지 않습니다." }, { status: 400 });
  }
  if (fileValue.size <= 0 || fileValue.size > MAX_IMAGE_SIZE_BYTES) {
    return NextResponse.json(
      { error: "이미지 파일은 5MB 이하만 업로드할 수 있습니다." },
      { status: 400 },
    );
  }

  const filename = normalizeUploadedFilename(fileValue.name || "mv-rating-image.png");
  const mimeType = fileValue.type || "image/png";
  const hasPngName = filename.toLowerCase().endsWith(".png");
  const hasAllowedMime = !fileValue.type || mimeType === "image/png";
  if (!hasPngName || !hasAllowedMime) {
    return NextResponse.json({ error: "PNG 파일만 업로드할 수 있습니다." }, { status: 400 });
  }
  const fileBuffer = Buffer.from(await fileValue.arrayBuffer());
  const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (fileBuffer.length < pngSignature.length || !fileBuffer.subarray(0, 8).equals(pngSignature)) {
    return NextResponse.json({ error: "올바른 PNG 파일이 아닙니다." }, { status: 400 });
  }

  const admin = createAdminClient();
  const settings = await loadSettings(admin);
  const previousObjectKey = settings.images[rating]?.objectKey ?? null;
  const safeName = sanitizeFileName(filename) || "mv-rating-image.png";
  const uploadedAt = new Date().toISOString();

  try {
    const { client, bucket, prefix } = getB2Config();
    const objectKey = `${prefix}admin-mv-rating-images/${rating}/${Date.now()}_${safeName}`;

    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: objectKey,
        Body: fileBuffer,
        ContentType: "image/png",
        ContentLength: fileValue.size,
      }),
    );

    settings.images[rating] = {
      objectKey,
      originalName: filename,
      mimeType: "image/png",
      sizeBytes: fileValue.size,
      updatedAt: uploadedAt,
    };

    const saveError = await saveSettings(admin, settings);
    if (saveError) {
      console.error("[admin][mv-rating-assets] save failed", saveError);
      await deleteObject(objectKey).catch((cleanupError) => {
        console.warn("[admin][mv-rating-assets] rollback delete failed", {
          objectKeyId: getStorageLogId(objectKey),
          errorName:
            cleanupError instanceof Error
              ? cleanupError.name
              : "UnknownError",
        });
      });
      return NextResponse.json(
        { error: "연령등급 이미지 설정을 저장하지 못했습니다." },
        { status: 500 },
      );
    }

    if (
      previousObjectKey &&
      previousObjectKey !== objectKey &&
      isCustomObjectKey(previousObjectKey)
    ) {
      await deleteObject(previousObjectKey).catch((error) => {
        console.warn("[admin][mv-rating-assets] previous delete failed", {
          objectKeyId: getStorageLogId(previousObjectKey),
          errorName: error instanceof Error ? error.name : "UnknownError",
        });
      });
    }

    return NextResponse.json({
      ok: true,
      ...(await buildAssetsPayload(req)),
    });
  } catch (error) {
    console.error("[admin][mv-rating-assets] upload failed", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return NextResponse.json(
      { error: "업로드에 실패했습니다." },
      { status: 500 },
    );
  }
}

export async function DELETE(req: NextRequest) {
  const { user, isAdmin } = await ensureAdmin();
  if (!user || isAdmin !== true) {
    return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as { rating?: unknown } | null;
  const rating = String(body?.rating ?? "").trim();
  if (!isManagedRating(rating) || !isRatingCode(rating)) {
    return NextResponse.json({ error: "등급 값을 확인해주세요." }, { status: 400 });
  }

  const admin = createAdminClient();
  const settings = await loadSettings(admin);
  const previousObjectKey = settings.images[rating]?.objectKey ?? null;
  delete settings.images[rating];

  const saveError = await saveSettings(admin, settings);
  if (saveError) {
    console.error("[admin][mv-rating-assets] delete save failed", saveError);
    return NextResponse.json(
      { error: "연령등급 이미지 설정을 삭제하지 못했습니다." },
      { status: 500 },
    );
  }

  if (isCustomObjectKey(previousObjectKey)) {
    const objectKeyToDelete = previousObjectKey;
    await deleteObject(objectKeyToDelete).catch((error) => {
      console.warn("[admin][mv-rating-assets] object delete failed", {
        objectKeyId: getStorageLogId(objectKeyToDelete),
        error,
      });
    });
  }

  return NextResponse.json({
    ok: true,
    ...(await buildAssetsPayload(req)),
  });
}
