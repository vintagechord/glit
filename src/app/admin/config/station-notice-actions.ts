"use server";

import { revalidatePath } from "next/cache";

import type { AdminActionState } from "@/features/admin/actions";
import { requireAdminAction } from "@/lib/admin/action-auth";
import { saveStationResultNotice } from "@/lib/station-result-notices";
import { createAdminClient } from "@/lib/supabase/admin";

/** 저장 with text sets the note; 안내 끄기 posts an empty text and removes it. */
export async function saveStationResultNoticeFormAction(form: FormData): Promise<AdminActionState> {
  await requireAdminAction();
  const remove = form.get("intent") === "remove";
  const result = await saveStationResultNotice(
    createAdminClient(),
    form.get("stationCode"),
    remove ? "" : form.get("text"),
  );
  if (!result.ok) return { error: result.error };
  revalidatePath("/admin/config");
  return { message: remove ? "안내를 껐습니다. 고객 화면에서 바로 사라집니다." : "안내 문구를 저장했습니다." };
}
