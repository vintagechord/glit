import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (relativePath: string) =>
  readFileSync(new URL(relativePath, import.meta.url), "utf8");

const migration = read(
  "../supabase/migrations/0076_submission_payment_integrity.sql",
);
const privilegedWriteMigration = read(
  "../supabase/migrations/0074_harden_privileged_writes.sql",
);
const returnHandler = read("../src/app/api/inicis/return/handler.ts");
const submissionPayment = read("../src/lib/payments/submission.ts");
const paypalPayment = read("../src/lib/payments/paypal.ts");

test("payment order creation and approval are transaction-scoped RPCs", () => {
  assert.match(migration, /function public\.begin_submission_payment_order/);
  assert.match(migration, /for update;[\s\S]*insert into public\.submission_payments/);
  assert.match(
    migration,
    /insert into public\.submission_payments[\s\S]*update public\.submissions/,
  );

  assert.match(migration, /function public\.approve_submission_payment_order/);
  assert.match(
    migration,
    /update public\.submission_payments[\s\S]*update public\.submissions[\s\S]*insert into public\.submission_events/,
  );

  assert.match(migration, /function public\.begin_submission_bank_payment/);
  assert.match(
    migration,
    /begin_submission_bank_payment[\s\S]*for update;[\s\S]*has_requested_submission_payments[\s\S]*payment_method = 'BANK'/,
  );
});

test("active grouped payments block primary and secondary submission deletion", () => {
  assert.match(
    migration,
    /function public\.submission_payment_group_ids[\s\S]*relatedSubmissionIds/,
  );
  assert.match(
    migration,
    /function public\.prevent_requested_payment_submission_delete/,
  );
  assert.match(
    migration,
    /payment\.status = 'REQUESTED'[\s\S]*PAYMENT_IN_PROGRESS/,
  );
  assert.match(
    migration,
    /before delete on public\.submissions[\s\S]*prevent_requested_payment_submission_delete/,
  );
  assert.match(
    migration,
    /function public\.cancel_requested_submission_payments_for_edit[\s\S]*submission_payment_includes_submission[\s\S]*close_submission_payment_order/,
  );
  assert.match(
    migration,
    /function public\.protect_requested_payment_submission_update[\s\S]*v_only_payment_start_fields_changed[\s\S]*PAYMENT_IN_PROGRESS/,
  );
});

test("terminal payment states cannot be revived by a late callback", () => {
  assert.match(
    migration,
    /old\.status in \('APPROVED', 'FAILED', 'CANCELED'\)/,
  );
  assert.match(migration, /raise exception 'PAYMENT_TERMINAL_STATE'/);
  assert.match(
    migration,
    /before update on public\.submission_payments[\s\S]*protect_submission_payment_terminal_state/,
  );

  const terminalGuard = returnHandler.indexOf(
    "!canHandlePaymentApprovalCallback(paymentStatus)",
  );
  const gatewayApproval = returnHandler.indexOf(
    "const approval = await requestStdPayApproval",
  );
  assert.ok(terminalGuard >= 0);
  assert.ok(gatewayApproval > terminalGuard);
});

test("application payment mutations use the atomic database RPCs", () => {
  assert.match(submissionPayment, /\.rpc\(\s*"begin_submission_payment_order"/);
  assert.match(submissionPayment, /\.rpc\("close_submission_payment_order"/);
  assert.match(submissionPayment, /\.rpc\("approve_submission_payment_order"/);
  assert.doesNotMatch(
    submissionPayment,
    /from\("submission_payments"\)\.insert\(/,
  );
});

test("album additional-price entitlement is enforced at payment start and PAID transition", () => {
  assert.match(
    migration,
    /add column if not exists album_base_price_krw[\s\S]*album_price_tier[\s\S]*album_discount_base_submission_id/,
  );
  assert.match(
    migration,
    /function public\.assert_album_price_snapshots[\s\S]*ALBUM_PRICE_SNAPSHOT_INVALID/,
  );
  assert.match(
    migration,
    /function public\.bind_album_payment_discount_eligibility[\s\S]*v_discounted\.user_id is null[\s\S]*base\.user_id is null[\s\S]*paid_base\.payment_status = 'PAID'[\s\S]*paid_base\.guest_token = v_discounted\.guest_token/,
  );
  const bindings = migration.match(
    /perform public\.bind_album_payment_discount_eligibility\(v_submission_ids\)/g,
  );
  assert.equal(
    bindings?.length,
    2,
    "card and bank start must both bind discount eligibility",
  );
  assert.match(
    migration,
    /function public\.enforce_paid_album_discount_eligibility[\s\S]*paid_base\.id = new\.album_discount_base_submission_id[\s\S]*paid_base\.payment_status = 'PAID'[\s\S]*create constraint trigger enforce_paid_album_discount_eligibility[\s\S]*deferrable initially deferred/,
  );
  assert.match(
    privilegedWriteMigration,
    /protected_keys constant text\[\][\s\S]*'album_base_price_krw'[\s\S]*'album_price_tier'[\s\S]*'album_discount_base_submission_id'/,
  );
  assert.match(
    privilegedWriteMigration,
    /new_row ->> 'album_discount_base_submission_id' is not null/,
  );
});

test("legacy album snapshots only backfill exact trusted package price candidates", () => {
  assert.match(
    migration,
    /Backfill only legacy prices[\s\S]*join public\.packages package[\s\S]*package\.is_active = true/,
  );
  assert.match(
    migration,
    /legacy\.original_base_price_krw[\s\S]*100 - legacy\.discount_percent[\s\S]*legacy\.original_base_price_krw \* 0\.5/,
  );
  assert.match(
    migration,
    /candidate\.amount_krw = base_price[\s\S]*candidate\.amount_krw::bigint \* 2 = base_price::bigint/,
  );
  assert.match(
    migration,
    /legacy_match\.base_price_krw is not null[\s\S]*legacy_match\.price_tier is not null/,
  );
});

test("PayPal capture uses a finite database lease and an idempotent gateway key", () => {
  assert.match(
    migration,
    /result_code = 'CAPTURE_IN_PROGRESS'[\s\S]*updated_at >= now\(\) - interval '2 minutes'/,
  );
  assert.match(
    paypalPayment,
    /"PayPal-Request-Id": `onside-capture-\$\{orderId\}`/,
  );
});

test("PayPal payment persistence stores only allowlisted gateway audit fields", () => {
  assert.match(paypalPayment, /paypalOrder: summarizePayPalOrderAudit\(json\)/);
  assert.equal(
    paypalPayment.match(/p_raw_response: summarizePayPalCaptureAudit\(json\)/g)
      ?.length,
    2,
  );
  assert.doesNotMatch(paypalPayment, /paypalOrder: json/);
  assert.doesNotMatch(paypalPayment, /p_raw_response: json/);
});
