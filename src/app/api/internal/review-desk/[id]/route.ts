import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getServiceRoleKey } from "@/lib/supabase/env";
import { createReviewDeskHandlers } from "@/lib/admin/review-desk-handler";
import { loadDeskResults, downloadDeskResultAsset } from "@/lib/admin/review-desk";
import { saveManagedStationReview, saveManagedOnlineReview } from "@/lib/admin/review-management";
import { saveManagedCertificate } from "@/lib/admin/certificate-save";
import { getReviewSummaryEmailPreviewById, sendReviewSummaryNotificationById } from "@/lib/admin/submission-notifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const handlers = createReviewDeskHandlers({
  secret: getServiceRoleKey, createDb: createAdminClient,
  loadSnapshot: loadDeskResults, downloadAsset: downloadDeskResultAsset,
  saveStation: saveManagedStationReview, saveOnline: saveManagedOnlineReview,
  saveCertificate: saveManagedCertificate,
  previewEmail: getReviewSummaryEmailPreviewById, sendSummary: sendReviewSummaryNotificationById,
  revalidate(id) {
    for (const prefix of ["", "/en"]) {
      for (const path of ["/admin/submissions", "/admin/submissions/detail", `/admin/submissions/${id}`, "/dashboard", `/dashboard/submissions/${id}`, "/mypage", `/mypage/submissions/${id}`, "/track"]) revalidatePath(`${prefix}${path}`);
    }
  },
});
export const GET = handlers.GET;
export const POST = handlers.POST;
