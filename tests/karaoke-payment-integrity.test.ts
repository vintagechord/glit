import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (relativePath: string) =>
  readFileSync(new URL(relativePath, import.meta.url), "utf8");

const migration = read(
  "../supabase/migrations/0082_karaoke_payment_integrity.sql",
);
const karaokePayment = read("../src/lib/payments/karaoke.ts");
const returnHandler = read("../src/app/api/inicis/return/handler.ts");

test("karaoke payment creation and finalization use transaction-scoped RPCs", () => {
  assert.match(migration, /function public\.begin_karaoke_payment_order/);
  assert.match(migration, /function public\.approve_karaoke_payment_order/);
  assert.match(migration, /function public\.close_karaoke_payment_order/);
  assert.match(
    migration,
    /from public\.karaoke_requests request[\s\S]*for update;[\s\S]*insert into public\.karaoke_payments/,
  );
  assert.match(
    migration,
    /from public\.karaoke_payments payment[\s\S]*for update;[\s\S]*KARAOKE_PAYMENT_TERMINAL_STATE/,
  );
  assert.match(migration, /p_callback_state is distinct from v_stored_state/);
  assert.match(migration, /v_payment\.amount_krw is distinct from p_amount_krw/);
  assert.match(migration, /v_request\.order_id is distinct from v_payment\.order_id/);
  assert.match(migration, /create trigger protect_karaoke_payment_terminal_state/);
  assert.match(migration, /create trigger protect_karaoke_request_paid_state/);

  for (const rpc of [
    "begin_karaoke_payment_order",
    "approve_karaoke_payment_order",
    "close_karaoke_payment_order",
  ]) {
    assert.match(
      migration,
      new RegExp(`revoke all on function public\\.${rpc}\\([\\s\\S]*authenticated`),
    );
    assert.match(
      migration,
      new RegExp(`grant execute on function public\\.${rpc}\\([\\s\\S]*service_role`),
    );
  }
});

test("application karaoke mutations call only the atomic payment RPCs", () => {
  assert.match(karaokePayment, /admin\.rpc\(\s*"begin_karaoke_payment_order"/);
  assert.match(karaokePayment, /admin\.rpc\("approve_karaoke_payment_order"/);
  assert.match(karaokePayment, /admin\.rpc\("close_karaoke_payment_order"/);
  assert.doesNotMatch(
    karaokePayment,
    /\.from\("karaoke_payments"\)[\s\S]{0,120}\.update\(/,
  );

  assert.match(
    returnHandler,
    /markKaraokePaymentFailure\(orderId,[\s\S]*callback_state: receivedCallbackState/,
  );
  assert.match(
    returnHandler,
    /const successPayload = \{[\s\S]*amount_krw: totPrice/,
  );
});
