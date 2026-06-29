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

const magazineRequestSchema = z.object({
  submissionId: z.string().uuid().optional(),
  guestLookupCode: z.string().min(8).optional(),
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

type SubmissionForMagazine = {
  id: string;
  user_id: string | null;
  guest_token: string | null;
  type: string | null;
  payment_status: string | null;
  title: string | null;
  artist_name: string | null;
  release_date: string | null;
  applicant_name?: string | null;
  applicant_email?: string | null;
  applicant_phone?: string | null;
  guest_name?: string | null;
  guest_email?: string | null;
  guest_phone?: string | null;
};

const submissionSelect =
  "id, user_id, guest_token, type, payment_status, title, artist_name, release_date, applicant_name, applicant_email, applicant_phone, guest_name, guest_email, guest_phone";

const withSavedQuery = (path: string) => {
  const [pathname, query] = path.split("?");
  const params = new URLSearchParams(query ?? "");
  params.set("saved", "1");
  return `${pathname}?${params.toString()}`;
};

const safeAdminRedirectPath = (redirectTo?: string) => {
  const raw = redirectTo?.trim();
  if (!raw || !raw.startsWith("/admin/magazine")) return "/admin/magazine";
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

async function findSubmissionForMagazine({
  submissionId,
  guestLookupCode,
}: {
  submissionId?: string;
  guestLookupCode?: string;
}) {
  const admin = createAdminClient();
  const query = admin.from("submissions").select(submissionSelect);
  const result = submissionId
    ? await query.eq("id", submissionId).maybeSingle()
    : await query.eq("guest_token", guestLookupCode ?? "").maybeSingle();

  return {
    submission: result.data as SubmissionForMagazine | null,
    error: result.error,
  };
}

export async function createMagazineRequestAction(
  payload: z.infer<typeof magazineRequestSchema>,
): Promise<MagazineRequestActionState> {
  const parsed = magazineRequestSchema.safeParse(payload);
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

  const isGuest = !user;
  if (!isGuest && !parsed.data.submissionId) {
    return { error: "사용할 매거진 크레딧을 선택해주세요." };
  }
  if (isGuest && !parsed.data.guestLookupCode?.trim()) {
    return { error: "비회원은 음반심의 조회 코드를 입력해주세요." };
  }

  const { submission, error: submissionError } =
    await findSubmissionForMagazine({
      submissionId: parsed.data.submissionId,
      guestLookupCode: parsed.data.guestLookupCode?.trim(),
    });

  if (submissionError || !submission) {
    return { error: "결제 완료된 음반심의 접수를 찾을 수 없습니다." };
  }

  if (submission.type !== "ALBUM") {
    return { error: "매거진 발행 요청은 음반심의 결제 건만 사용할 수 있습니다." };
  }
  if (submission.payment_status !== "PAID") {
    return { error: "음반심의 결제 완료 후 매거진 발행 요청이 가능합니다." };
  }
  if (user && submission.user_id !== user.id) {
    return { error: "본인 음반심의 접수만 사용할 수 있습니다." };
  }
  if (isGuest && submission.guest_token !== parsed.data.guestLookupCode?.trim()) {
    return { error: "조회 코드와 일치하는 비회원 접수를 확인할 수 없습니다." };
  }

  const admin = createAdminClient();
  if (user) {
    const creditSummary = await getUserCreditSummary(admin, user.id);
    if (creditSummary.available < 1) {
      return {
        error:
          "사용 가능한 크레딧이 없습니다. 나의 크레딧에서 적립/사용 내역을 확인해주세요.",
      };
    }
  }

  const { data: existingRequest, error: existingError } = await admin
    .from("magazine_requests")
    .select("id")
    .eq("submission_id", submission.id)
    .maybeSingle();

  if (existingError) {
    console.error("[magazine] duplicate check failed", existingError);
    return { error: "매거진 크레딧 사용 여부를 확인하지 못했습니다." };
  }
  if (existingRequest?.id) {
    return { error: "이미 이 음반심의 건으로 매거진 발행 요청이 접수되었습니다." };
  }

  const { data: request, error: insertError } = await admin
    .from("magazine_requests")
    .insert({
      submission_id: submission.id,
      user_id: user?.id ?? null,
      guest_token: isGuest ? submission.guest_token : null,
      target_channel: parsed.data.targetChannel,
      requester_name: parsed.data.requesterName,
      requester_email: parsed.data.requesterEmail,
      requester_phone: parsed.data.requesterPhone ?? null,
      album_title: parsed.data.albumTitle ?? submission.title ?? null,
      artist_name: parsed.data.artistName ?? submission.artist_name ?? null,
      release_date: parsed.data.releaseDate ?? submission.release_date ?? null,
      artwork_url: parsed.data.artworkUrl ?? null,
      album_url: parsed.data.albumUrl ?? null,
      video_url: parsed.data.videoUrl ?? null,
      article_body: parsed.data.articleBody ?? null,
      credits_text: parsed.data.creditsText ?? null,
      notes: parsed.data.notes ?? null,
    })
    .select("id")
    .maybeSingle();

  if (insertError) {
    if (insertError.code === "23505") {
      return { error: "이미 이 음반심의 건으로 매거진 발행 요청이 접수되었습니다." };
    }
    console.error("[magazine] request insert failed", insertError);
    return { error: "매거진 발행 요청을 저장하지 못했습니다." };
  }

  revalidatePath("/magazine");
  revalidatePath("/en/magazine");
  revalidatePath("/admin/magazine");

  return {
    message:
      "매거진 발행 요청이 접수되었습니다. 발매일 기준 3일 내 공개를 목표로 확인하겠습니다.",
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
  redirect(withSavedQuery(redirectPath));
}
