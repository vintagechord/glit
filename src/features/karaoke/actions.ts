"use server";

import { z } from "zod";

import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabase } from "@/lib/supabase/server";

export type KaraokeActionState = {
  error?: string;
  message?: string;
};

const karaokeRequestSchema = z.object({
  title: z.string().min(1),
  artist: z.string().optional(),
  contact: z.string().min(3),
  notes: z.string().optional(),
  filePath: z.string().optional(),
  guestName: z.string().min(1).optional(),
  guestEmail: z.string().email().optional(),
  guestPhone: z.string().min(3).optional(),
});

const karaokeStatusSchema = z.object({
  requestId: z.string().uuid(),
  status: z.enum(["REQUESTED", "IN_REVIEW", "COMPLETED"]),
});

export async function createKaraokeRequestAction(
  payload: z.infer<typeof karaokeRequestSchema>,
): Promise<KaraokeActionState> {
  const parsed = karaokeRequestSchema.safeParse(payload);
  if (!parsed.success) {
    return { error: "입력값을 확인해주세요." };
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
  if (isGuest && (!parsed.data.guestName || !parsed.data.guestEmail)) {
    return { error: "비회원 정보를 입력해주세요." };
  }

  const db = isGuest ? createAdminClient() : supabase;

  const { error } = await db.from("karaoke_requests").insert({
    user_id: user?.id ?? null,
    guest_name: isGuest ? parsed.data.guestName : null,
    guest_email: isGuest ? parsed.data.guestEmail : null,
    guest_phone: isGuest
      ? parsed.data.guestPhone ?? parsed.data.contact
      : null,
    title: parsed.data.title,
    artist: parsed.data.artist || null,
    contact: parsed.data.contact,
    notes: parsed.data.notes || null,
    file_path: parsed.data.filePath || null,
  });

  if (error) {
    return { error: "요청 접수에 실패했습니다." };
  }

  return { message: "노래방 등록 요청이 접수되었습니다." };
}

export async function updateKaraokeStatusAction(
  payload: z.infer<typeof karaokeStatusSchema>,
): Promise<KaraokeActionState> {
  const parsed = karaokeStatusSchema.safeParse(payload);
  if (!parsed.success) {
    return { error: "상태를 확인해주세요." };
  }

  const supabase = await createServerSupabase();
  const { error } = await supabase
    .from("karaoke_requests")
    .update({ status: parsed.data.status })
    .eq("id", parsed.data.requestId);

  if (error) {
    return { error: "상태 변경에 실패했습니다." };
  }

  return { message: "상태가 업데이트되었습니다." };
}

export async function updateKaraokeStatusFormAction(
  _prevState: KaraokeActionState,
  formData: FormData,
): Promise<KaraokeActionState> {
  return updateKaraokeStatusAction({
    requestId: String(formData.get("requestId") ?? ""),
    status: String(formData.get("status") ?? "") as
      | "REQUESTED"
      | "IN_REVIEW"
      | "COMPLETED",
  });
}
