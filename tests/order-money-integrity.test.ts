import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

const read = (relativePath: string) => readFileSync(new URL(relativePath, import.meta.url), "utf8");
const migration = (name: string) => read(`../supabase/migrations/${name}`);
const fn = (sql: string, name: string) => {
  const body = sql.match(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\$\\$;`))?.[0];
  assert.ok(body, `${name} is defined`);
  return body;
};

const audit = migration("20261103130000_payment_audit_mobile_fields.sql");
const receipts = migration("20261103131000_cash_receipt_uncertain_status.sql");
const money = migration("20261103132000_order_money_integrity.sql");
const karaoke = migration("20261103133000_karaoke_approval_claim.sql");
const subscription = migration("20261103134000_subscription_refund_admin_check.sql");
const added = [audit, receipts, money, karaoke, subscription];

test("this change adds migrations only inside its reserved window, after the earlier ones", () => {
  const names = readdirSync(new URL("../supabase/migrations/", import.meta.url)).filter(name => name.startsWith("2026110313"));
  assert.deepEqual(names.sort(), [
    "20261103130000_payment_audit_mobile_fields.sql",
    "20261103131000_cash_receipt_uncertain_status.sql",
    "20261103132000_order_money_integrity.sql",
    "20261103133000_karaoke_approval_claim.sql",
    "20261103134000_subscription_refund_admin_check.sql",
  ]);
});

test("every redefined function keeps server-only grants and a pinned search_path", () => {
  for (const sql of added) {
    for (const [, name] of sql.matchAll(/create or replace function public\.([a-z0-9_]+)\(/g)) {
      const body = fn(sql, name);
      assert.match(body, /set search_path\s*=\s*(?:''|public)/, name);
      assert.match(sql, new RegExp(`revoke all on function public\\.${name}\\([^;]*\\)\\s*from public,\\s*anon,\\s*authenticated`), name);
      if (!/returns trigger/.test(body)) assert.match(sql, new RegExp(`grant execute on function public\\.${name}\\([^;]*\\)\\s*to service_role`), name);
    }
  }
});

test("the database payment audit allowlist covers every key the application keeps, including the mobile channel", () => {
  const appKeys = [...read("../src/lib/inicis/payment-audit.ts").match(/const allowedKeys = new Set\(\[([\s\S]*?)\]\);/)![1].matchAll(/"([a-z0-9]+)"/g)].map(match => match[1]);
  const dbKeys = new Set([...fn(audit, "scrub_payment_audit_json").match(/v_allowed_keys constant text\[\] := array\[([\s\S]*?)\];/)![1].matchAll(/'([a-z0-9]+)'/g)].map(match => match[1]));
  assert.ok(appKeys.includes("channel"));
  assert.deepEqual(appKeys.filter(key => !dbKeys.has(key)), []);
  // Card numbers, bearer URLs and buyer identity stay out.
  for (const secret of ["pcardnum", "authtoken", "authurl", "buyeremail", "merchantdata", "signature"]) assert.equal(dbKeys.has(secret), false, secret);
  assert.match(fn(audit, "merge_submission_payment_raw_response"), /p_existing_raw_response ->> 'channel' in \('pc', 'mobile'\)/);
});

test("a late approval after the stale-claim hand-over pays the order; unclaimed attempts cannot be approved", () => {
  const approve = fn(money, "approve_submission_payment_order");
  assert.match(approve, /'APPROVAL_IN_PROGRESS'[\s\S]*'APPROVAL_UNCERTAIN'[\s\S]*'ADMIN_RECONCILED'[\s\S]*PAYMENT_APPROVAL_NOT_CLAIMED/);
  assert.match(approve, /v_payment\.result_code = 'APPROVAL_UNCERTAIN'[\s\S]*update public\.submission_orders o\s+set status = 'PAID'[\s\S]*o\.status = 'REVIEW_REQUIRED'/);
  // The order is paid only after the attempt itself became APPROVED.
  assert.ok(approve.indexOf("set status = 'APPROVED'") < approve.indexOf("set status = 'PAID'"));
});

test("administrator memos never reach the customer-visible order note and are appended, not overwritten", () => {
  for (const name of ["refund_submission_order", "resolve_uncertain_submission_payment", "confirm_submission_order_bank_payment", "admin_record_refund"]) {
    const body = fn(money, name);
    assert.doesNotMatch(body, /note\s*=\s*coalesce\(memo_text/, name);
    assert.doesNotMatch(body, /note\s*=[^,;]*(?:memo_text|v_note|p_admin_memo|p_note)/, name);
    assert.doesNotMatch(body, /admin_memo\s*=\s*coalesce\(/, name);
    if (body.includes("admin_memo")) assert.match(body, /admin_memo\s*=\s*(?:case[\s\S]*?)?concat_ws\(E'\\n', nullif\(btrim\(coalesce\((?:s\.)?admin_memo,''\)\),''\)/, name);
  }
  const resolve = fn(money, "resolve_uncertain_submission_payment");
  assert.match(resolve, /'카드 결제 승인이 확인되었습니다\.'/);
  assert.match(resolve, /'카드 결제가 승인되지 않은 것으로 확인되었습니다\. 다시 결제할 수 있습니다\.'/);
  // An open attempt locks its submissions, so the memo is written after it is settled.
  assert.ok(resolve.indexOf("close_submission_payment_order_v96") < resolve.indexOf("update public.submissions s set admin_memo"));
  assert.match(fn(money, "refund_submission_order"), /note=concat_ws\(E'\\n', nullif\(btrim\(coalesce\(o\.note,''\)\),''\), '환불 완료'\)/);
});

test("deleted payment attempts are archived in the same transaction and only the service role can read them", () => {
  assert.match(money, /create table if not exists public\.submission_payment_archive/);
  assert.match(money, /alter table public\.submission_payment_archive enable row level security/);
  assert.match(money, /revoke all on public\.submission_payment_archive from public, anon, authenticated, service_role;\s*grant select on public\.submission_payment_archive to service_role;/);
  const trigger = fn(money, "archive_deleted_submission_payment");
  assert.match(trigger, /security definer set search_path = ''/);
  assert.match(trigger, /old\.pg_tid[\s\S]*old\.paid_at[\s\S]*to_jsonb\(old\)/);
  assert.match(money, /create trigger archive_deleted_submission_payment before delete on public\.submission_payments\s+for each row/);
  // Deleting refunded test orders stays possible.
  assert.doesNotMatch(fn(money, "admin_delete_submissions"), /REFUNDED_SUBMISSION|payment_status in \('PAID','REFUNDED'\)/);
});

test("refunds and administrator deletion close unissued receipt requests; issued ones wait for Hometax", () => {
  for (const name of ["refund_submission_order", "admin_record_refund", "admin_delete_submissions"]) {
    const body = fn(money, name);
    assert.match(body, /update public\.submission_order_cash_receipts r set status='CANCELED'[\s\S]*?r\.status in \('REQUESTED','FAILED'\)/, name);
    assert.doesNotMatch(body, /submission_order_cash_receipts[\s\S]{0,300}'ISSUED'/, name);
  }
});

test("uncertain cash receipts get their own status and stay visible to the review desk", () => {
  assert.match(receipts, /check \(status in \('REQUESTED','ISSUING','ISSUED','FAILED','CANCELED','UNCERTAIN'\)\)/);
  assert.match(receipts, /set status = 'UNCERTAIN'[\s\S]*failure_message like '\[결과 확인 필요\]%'/);
  assert.match(fn(receipts, "site_monitoring_snapshot"), /case when status = 'UNCERTAIN' then 'FAILED' else status end/);
  assert.match(fn(receipts, "site_monitoring_snapshot"), /security definer set search_path = ''/);
});

test("karaoke approvals are claimed under the row lock, and a claimed attempt can only be settled by its holder", () => {
  const claim = fn(karaoke, "claim_inicis_karaoke_approval");
  assert.match(claim, /from public\.karaoke_payments where order_id=p_order_id for update/);
  assert.match(claim, /\(p\.raw_response->>'closeState'\) is distinct from p_callback_state/);
  assert.match(claim, /result_code in \('APPROVAL_IN_PROGRESS','APPROVAL_UNCERTAIN'\)[\s\S]*select false,true/);
  assert.match(claim, /result_code='APPROVAL_IN_PROGRESS'/);
  const settle = fn(karaoke, "settle_inicis_karaoke_approval");
  assert.match(settle, /p\.result_code is distinct from 'APPROVAL_IN_PROGRESS'[\s\S]*APPROVAL_CLAIM_NOT_ACTIVE/);
  assert.match(settle, /p_outcome='UNCERTAIN'[\s\S]*result_code='APPROVAL_UNCERTAIN'[\s\S]*else[\s\S]*status='FAILED'[\s\S]*payment_status='UNPAID'/);
  assert.match(fn(karaoke, "close_karaoke_payment_order"), /result_code in \('APPROVAL_IN_PROGRESS', 'APPROVAL_UNCERTAIN'\)[\s\S]*KARAOKE_PAYMENT_APPROVAL_IN_PROGRESS/);
});

test("subscription refund RPCs verify the administrator before honouring p_allow_admin", () => {
  for (const name of ["claim_subscription_refund", "fail_subscription_refund", "finalize_subscription_refund"]) {
    assert.match(fn(subscription, name), /coalesce\(p_allow_admin, false\)\s*and not exists \(\s*select 1 from public\.profiles profile\s*where profile\.user_id = p_actor_user_id and profile\.role = 'admin'/, name);
  }
});
