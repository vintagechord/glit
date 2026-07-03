"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabase } from "@/lib/supabase/server";
import { getUserCreditSummary } from "@/lib/credits";

export type MagazineRequestActionState = {
  error?: string;
  message?: string;
  requestId?: string;
};

const targetChannelSchema = z.enum(["DOMESTIC_NEWS", "MEDIA"]);
const magazineStatusSchema = z.enum([
  "REQUESTED",
  "WRITING",
  "PUBLISHED",
  "CANCELED",
]);

const optionalText = z.preprocess((value) => {
  const text = String(value ?? "").trim();
  return text.length > 0 ? text : undefined;
}, z.string().optional());

const optionalDate = z.preprocess((value) => {
  const text = String(value ?? "").trim();
  return text.length > 0 ? text : undefined;
}, z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional());

const optionalUrl = z.preprocess((value) => {
  const text = String(value ?? "").trim();
  if (!text) return undefined;
  return /^https?:\/\//i.test(text) ? text : `https://${text}`;
}, z.string().url().optional());

const magazineArtworkBucket = "magazine-artwork";
const maxArtworkBytes = 20 * 1024 * 1024;
const artworkImageTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

const magazineRequestSchema = z.object({
  submissionId: z.string().uuid().optional(),
  targetChannel: targetChannelSchema,
  requesterName: z.string().trim().min(1),
  requesterEmail: z.string().trim().email(),
  requesterPhone: optionalText,
  albumTitle: optionalText,
  artistName: optionalText,
  releaseDate: optionalDate,
  artworkUrl: optionalUrl,
  albumUrl: optionalUrl,
  videoUrl: optionalUrl,
  articleBody: optionalText,
  creditsText: optionalText,
  notes: optionalText,
});

const magazineStatusUpdateSchema = z.object({
  requestId: z.string().uuid(),
  status: magazineStatusSchema,
  publishedUrl: optionalUrl,
  adminMemo: optionalText,
  redirectTo: optionalText,
});

const sanitizeStorageFileName = (name: string) =>
  name
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 120);

const isUploadedFile = (value: unknown): value is File => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as {
    arrayBuffer?: unknown;
    name?: unknown;
    size?: unknown;
  };
  return (
    typeof candidate.arrayBuffer === "function" &&
    typeof candidate.name === "string" &&
    typeof candidate.size === "number" &&
    candidate.size > 0
  );
};

const isValidArtworkFile = (file: File) => {
  const mimeType = file.type.toLowerCase();
  if (mimeType && artworkImageTypes.has(mimeType)) return true;
  return /\.(jpe?g|png|webp|gif)$/i.test(file.name);
};

const getArtworkContentType = (file: File) => {
  const mimeType = file.type.toLowerCase();
  if (artworkImageTypes.has(mimeType)) return mimeType;
  const lowerName = file.name.toLowerCase();
  if (lowerName.endsWith(".png")) return "image/png";
  if (lowerName.endsWith(".webp")) return "image/webp";
  if (lowerName.endsWith(".gif")) return "image/gif";
  return "image/jpeg";
};

const getMagazinePayload = (
  payload: z.infer<typeof magazineRequestSchema> | FormData,
) => {
  if (typeof FormData !== "undefined" && payload instanceof FormData) {
    const artworkEntry = payload.get("artworkFile");
    return {
      values: {
        submissionId: payload.get("submissionId") || undefined,
        targetChannel: payload.get("targetChannel"),
        requesterName: payload.get("requesterName"),
        requesterEmail: payload.get("requesterEmail"),
        requesterPhone: payload.get("requesterPhone"),
        albumTitle: payload.get("albumTitle"),
        artistName: payload.get("artistName"),
        releaseDate: payload.get("releaseDate"),
        artworkUrl: payload.get("artworkUrl"),
        albumUrl: payload.get("albumUrl"),
        videoUrl: payload.get("videoUrl"),
        articleBody: payload.get("articleBody"),
        creditsText: payload.get("creditsText"),
        notes: payload.get("notes"),
      },
      artworkFile: isUploadedFile(artworkEntry) ? artworkEntry : undefined,
    };
  }

  return {
    values: payload,
    artworkFile: undefined,
  };
};

async function uploadMagazineArtworkFile({
  admin,
  file,
  scopeId,
  userId,
}: {
  admin: ReturnType<typeof createAdminClient>;
  file: File;
  scopeId: string;
  userId: string;
}) {
  if (!isValidArtworkFile(file)) {
    return { error: "대표 이미지는 JPG, PNG, WEBP, GIF 이미지 파일만 첨부할 수 있습니다." };
  }
  if (file.size > maxArtworkBytes) {
    return { error: "대표 이미지 파일은 20MB 이하로 첨부해주세요." };
  }

  const safeName = sanitizeStorageFileName(file.name || "artwork.jpg");
  const path = `${userId}/${scopeId}/${Date.now()}-${safeName}`;
  const arrayBuffer = await file.arrayBuffer();

  const { error } = await admin.storage
    .from(magazineArtworkBucket)
    .upload(path, arrayBuffer, {
      contentType: getArtworkContentType(file),
      upsert: false,
    });

  if (error) {
    console.error("[magazine] artwork upload failed", error);
    return { error: "대표 이미지 파일 업로드에 실패했습니다." };
  }

  const { data } = admin.storage.from(magazineArtworkBucket).getPublicUrl(path);
  return { publicUrl: data.publicUrl, path };
}

const withSavedQuery = (path: string) => {
  const [baseWithQuery, hash] = path.split("#");
  const [pathname, query] = baseWithQuery.split("?");
  const params = new URLSearchParams(query ?? "");
  params.set("saved", "1");
  const nextPath = `${pathname}?${params.toString()}`;
  return hash ? `${nextPath}#${hash}` : nextPath;
};

const safeAdminRedirectPath = (redirectTo?: string) => {
  const raw = redirectTo?.trim();
  if (
    !raw ||
    (!raw.startsWith("/admin/magazine") &&
      !raw.startsWith("/admin/credits/requests"))
  ) {
    return "/admin/magazine";
  }
  return raw;
};

async function isAdminUser(userId: string) {
  const admin = createAdminClient();
  const { data } = await admin
    .from("profiles")
    .select("role")
    .eq("user_id", userId)
    .maybeSingle();
  return data?.role === "admin";
}

const normalizeMagazineRpcError = (message?: string | null) => {
  const raw = message ?? "";
  if (raw.includes("LOGIN_REQUIRED")) {
    return "로그인 후 매거진 등록을 신청할 수 있습니다.";
  }
  if (raw.includes("INSUFFICIENT_CREDITS")) {
    return "사용 가능한 크레딧이 없습니다. 나의 크레딧에서 적립/사용 내역을 확인해주세요.";
  }
  if (raw.includes("INVALID_SUBMISSION")) {
    return "연결할 수 없는 음반심의 접수입니다.";
  }
  if (raw.includes("DUPLICATE_SUBMISSION")) {
    return "이미 이 음반심의 건으로 매거진 발행 요청이 접수되었습니다.";
  }
  if (raw.includes("INVALID_TARGET_CHANNEL")) {
    return "발행 위치를 다시 선택해주세요.";
  }
  return "매거진 발행 요청을 저장하지 못했습니다.";
};

export async function createMagazineRequestAction(
  payload: z.infer<typeof magazineRequestSchema> | FormData,
): Promise<MagazineRequestActionState> {
  const { values, artworkFile } = getMagazinePayload(payload);
  const parsed = magazineRequestSchema.safeParse(values);
  if (!parsed.success) {
    return { error: "입력값을 확인해주세요. URL은 https:// 형식으로 입력해주세요." };
  }

  const supabase = await createServerSupabase();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError) {
    return { error: "로그인 정보를 확인할 수 없습니다." };
  }

  if (!user) {
    return { error: "로그인한 회원만 크레딧을 사용할 수 있습니다." };
  }

  const admin = createAdminClient();
  const creditSummary = await getUserCreditSummary(admin, user.id);
  if (creditSummary.available < 1) {
    return {
      error:
        "사용 가능한 크레딧이 없습니다. 나의 크레딧에서 적립/사용 내역을 확인해주세요.",
    };
  }

  const uploadedArtwork = artworkFile
    ? await uploadMagazineArtworkFile({
        admin,
        file: artworkFile,
        scopeId: parsed.data.submissionId ?? "general",
        userId: user.id,
      })
    : null;

  if (uploadedArtwork?.error) {
    return { error: uploadedArtwork.error };
  }

  const { data: requestData, error: insertError } = await supabase.rpc(
    "create_magazine_request",
    {
      p_submission_id: parsed.data.submissionId ?? null,
      p_target_channel: parsed.data.targetChannel,
      p_requester_name: parsed.data.requesterName,
      p_requester_email: parsed.data.requesterEmail,
      p_requester_phone: parsed.data.requesterPhone ?? null,
      p_album_title: parsed.data.albumTitle ?? null,
      p_artist_name: parsed.data.artistName ?? null,
      p_release_date: parsed.data.releaseDate ?? null,
      p_artwork_url: uploadedArtwork?.publicUrl ?? parsed.data.artworkUrl ?? null,
      p_album_url: parsed.data.albumUrl ?? null,
      p_video_url: parsed.data.videoUrl ?? null,
      p_article_body: parsed.data.articleBody ?? null,
      p_credits_text: parsed.data.creditsText ?? null,
      p_notes: parsed.data.notes ?? null,
    },
  );

  if (insertError) {
    if (uploadedArtwork?.path) {
      const { error: cleanupError } = await admin.storage
        .from(magazineArtworkBucket)
        .remove([uploadedArtwork.path]);
      if (cleanupError) {
        console.error("[magazine] artwork cleanup failed", cleanupError);
      }
    }
    console.error("[magazine] request insert failed", insertError);
    return { error: normalizeMagazineRpcError(insertError.message) };
  }

  revalidatePath("/magazine");
  revalidatePath("/en/magazine");
  revalidatePath("/mypage/credits");
  revalidatePath("/dashboard/credits");
  revalidatePath("/admin/magazine");
  revalidatePath("/admin/credits/requests");

  const request = requestData as { id?: string } | null;

  return {
    message:
      "매거진 등록 신청이 접수되었습니다. 관리자가 내용을 확인합니다.",
    requestId: request?.id ?? undefined,
  };
}

export async function updateMagazineRequestStatusFormAction(
  formData: FormData,
): Promise<void> {
  const parsed = magazineStatusUpdateSchema.safeParse({
    requestId: formData.get("requestId"),
    status: formData.get("status"),
    publishedUrl: formData.get("publishedUrl"),
    adminMemo: formData.get("adminMemo"),
    redirectTo: formData.get("redirectTo"),
  });

  const redirectPath = safeAdminRedirectPath(
    parsed.success ? parsed.data.redirectTo : undefined,
  );
  if (!parsed.success) {
    console.error("[magazine] invalid status update payload", parsed.error);
    redirect(redirectPath);
  }

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || !(await isAdminUser(user.id))) {
    redirect("/login");
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("magazine_requests")
    .update({
      status: parsed.data.status,
      published_url: parsed.data.publishedUrl ?? null,
      admin_memo: parsed.data.adminMemo ?? null,
    })
    .eq("id", parsed.data.requestId);

  if (error) {
    console.error("[magazine] status update failed", error);
    redirect(redirectPath);
  }

  revalidatePath("/admin/magazine");
  revalidatePath("/admin/credits");
  revalidatePath("/admin/credits/requests");
  revalidatePath("/magazine");
  revalidatePath("/mypage/credits");
  redirect(withSavedQuery(redirectPath));
}
