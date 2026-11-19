"use server";

import { revalidatePath } from "next/cache";

import { requireAdminAction } from "@/lib/admin/action-auth";
import { markAdminSectionSeen } from "@/lib/admin/menu-attention";
import { createAdminClient } from "@/lib/supabase/admin";

/** Called by the request pages once they are on screen (never by a link
 * prefetch), so the 관리 메뉴 badge for that page clears. */
export async function markAdminSectionSeenAction(section: string, renderedAt?: string): Promise<{ ok: boolean }> {
  const actor = await requireAdminAction();
  const result = await markAdminSectionSeen(createAdminClient(), {
    userId: actor.id,
    section: String(section ?? ""),
    renderedAt: typeof renderedAt === "string" ? renderedAt : null,
  });
  if (result.ok) revalidatePath("/admin");
  return result;
}
