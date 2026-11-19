import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync("supabase/migrations/20261119200000_admin_delete_paid_submissions.sql", "utf8");

test("administrators can delete paid and refunded applications while the order stays as the money record", () => {
  assert.doesNotMatch(migration, /raise exception 'PAID_SUBMISSION'/);
  // A settled order keeps its status and gets a fixed notice once.
  assert.match(migration, /if v_order_status in \('PAID','REFUNDED'\) then[\s\S]*settled_orders := settled_orders \|\| jsonb_build_object/);
  assert.match(migration, /status=settled_orders->>v_order_id::text/);
  assert.match(migration, /position\(paid_notice in coalesce\(o\.note,''\)\)>0 then o\.note/);
  // Requested cash receipts are cancelled only for orders that were never paid.
  const settledBranch = migration.slice(migration.indexOf("if settled_orders ? v_order_id::text then"), migration.indexOf("    else\n      update public.submission_orders o set\n        status=case"));
  assert.doesNotMatch(settledBranch, /submission_order_cash_receipts/);
  // An approval the gateway is confirming, or whose outcome is unknown, is still refused.
  assert.match(migration, /if v_order_status='REVIEW_REQUIRED' then\s+raise exception 'PAYMENT_APPROVAL_IN_PROGRESS'/);
  assert.match(migration, /'APPROVAL_IN_PROGRESS','APPROVAL_UNCERTAIN','CAPTURE_IN_PROGRESS'/);
  assert.match(migration, /grant execute on function public\.admin_delete_submissions\(uuid\[\],uuid\) to service_role/);
});

test("the delete button warns before removing a paid application, and the old refusal text is gone", () => {
  const actions = readFileSync("src/features/admin/actions.ts", "utf8");
  assert.doesNotMatch(actions, /결제 완료된 접수는 삭제할 수 없습니다/);
  const button = readFileSync("src/components/admin/delete-button.tsx", "utf8");
  assert.match(button, /결제 완료된 접수입니다\. 삭제하면 접수 내용과 제출 파일이 모두 지워지고 되돌릴 수 없습니다\. 주문·결제 내역은 그대로 남습니다\./);
  for (const page of ["src/app/admin/submissions/page.tsx", "src/app/admin/submissions/detail/page.tsx"]) {
    assert.match(readFileSync(page, "utf8"), /paid=\{submission\.payment_status === "PAID" \|\| submission\.payment_status === "REFUNDED"\}/, page);
  }
});
