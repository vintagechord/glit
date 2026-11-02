import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getServiceRoleKey } from "@/lib/supabase/env";
import { createReviewDeskIntakeHandlers } from "@/lib/admin/review-desk-handler";
import { listGuestAlbumIntakePackages } from "@/lib/admin/guest-album-intake";
import { ensureArtistByName } from "@/lib/artist";
import { buildUrl, getBaseUrl } from "@/lib/url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const handlers = createReviewDeskIntakeHandlers({
  secret: getServiceRoleKey, createDb: createAdminClient,
  listPackages: listGuestAlbumIntakePackages,
  ensureArtist: ensureArtistByName,
  trackUrl: (guestToken) => buildUrl(`/track/${encodeURIComponent(guestToken)}`, getBaseUrl()),
  revalidate(id) {
    for (const path of ["/admin/submissions", "/admin/submissions/detail", `/admin/submissions/${id}`]) revalidatePath(path);
  },
});
export const GET = handlers.GET;
export const POST = handlers.POST;
