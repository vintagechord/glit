import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";

loadEnvConfig(process.cwd());

// Defaults to a read-only summary. Run with --apply for the campaign retirement.
// No personal/contact data is read or logged, and issued orders are excluded.
const apply = process.argv.includes("--apply");
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const editableStatuses = ["DRAFT", "PRE_REVIEW", "SUBMITTED", "WAITING_PAYMENT"];
type PriceRow = {
  id: string;
  updated_at: string;
  amount_krw: number | null;
  album_base_price_krw: number | null;
  album_price_tier: string | null;
  album_discount_base_submission_id: string | null;
  album_draft_group_id: string | null;
  package: { price_krw: number } | null;
};

async function main() {
  const rows: PriceRow[] = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await db.from("submissions")
      .select("id, updated_at, amount_krw, album_base_price_krw, album_price_tier, album_discount_base_submission_id, album_draft_group_id, package:packages(price_krw)")
      .eq("type", "ALBUM")
      .in("status", editableStatuses)
      .or("payment_status.is.null,payment_status.eq.UNPAID")
      .is("current_order_id", null)
      .order("id")
      .range(offset, offset + 499);
    if (error) throw error;
    rows.push(...(data as unknown as PriceRow[]));
    if (data.length < 500) break;
  }
  const changed = rows.filter((row) => {
    const price = row.package?.price_krw;
    return Number.isSafeInteger(price) && Number(price) > 0 &&
      (row.amount_krw !== price || row.album_base_price_krw !== price ||
        row.album_price_tier !== "FULL" || row.album_discount_base_submission_id !== null ||
        row.album_draft_group_id !== null);
  });
  console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", editableAlbums: rows.length, pricesToRestore: changed.length }));
  if (!apply) return;
  // Retire the shared campaign before restoring drafts. New code also ignores
  // legacy cached campaign settings so no stale client can reactivate it.
  const setting = await db.from("site_settings")
    .update({ value: { discountPercent: 0 } })
    .eq("key", "album_review_discount_percent")
    .select("key");
  if (setting.error || setting.data?.length !== 1) throw setting.error ?? new Error("Campaign setting missing");
  const banner = await db.from("ad_banners")
    .update({ is_active: false })
    .eq("placement", "HOME_HERO")
    .eq("title", "리뉴얼 기념 음반심의 30% 할인")
    .select("id");
  if (banner.error) throw banner.error;

  let updated = 0;
  let skipped = 0;
  // Detach additional-album links first, before changing any referenced base.
  changed.sort((a, b) => Number(b.album_price_tier === "ADDITIONAL") - Number(a.album_price_tier === "ADDITIONAL"));
  for (const row of changed) {
    const price = row.package!.price_krw;
    const result = await db.from("submissions").update({
      amount_krw: price,
      album_base_price_krw: price,
      album_price_tier: "FULL",
      album_discount_base_submission_id: null,
      album_draft_group_id: null,
    })
      .eq("id", row.id).eq("updated_at", row.updated_at)
      .eq("type", "ALBUM").in("status", editableStatuses)
      .or("payment_status.is.null,payment_status.eq.UNPAID")
      .is("current_order_id", null).select("id");
    if (result.error) throw result.error;
    if (result.data?.length === 1) updated += 1;
    else skipped += 1; // Concurrently edited/ordered rows are left untouched.
  }
  console.log(JSON.stringify({ campaignDiscountPercent: 0, retiredBanners: banner.data?.length ?? 0, restored: updated, concurrentlyChanged: skipped }));
}

main().catch((error: { code?: string; message?: string }) => {
  console.error(JSON.stringify({ code: error.code, message: error.message }));
  process.exitCode = 1;
});
