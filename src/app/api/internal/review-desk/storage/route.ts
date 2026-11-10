import { createAdminClient } from "@/lib/supabase/admin";
import { getServiceRoleKey } from "@/lib/supabase/env";
import { createReviewDeskStorageHandlers } from "@/lib/admin/review-desk-handler";
import { loadPurgeCandidates, purgeCustomerFiles } from "@/lib/admin/customer-file-purge";
import { deleteStorageLeftovers, loadStorageInventory } from "@/lib/admin/storage-inventory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const handlers = createReviewDeskStorageHandlers({
  secret: getServiceRoleKey, createDb: createAdminClient,
  loadCandidates: loadPurgeCandidates, purge: purgeCustomerFiles,
  loadInventory: loadStorageInventory, deleteLeftovers: deleteStorageLeftovers,
});
export const GET = handlers.GET;
export const POST = handlers.POST;
