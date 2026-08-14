import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { scrubInicisPaymentAudit } from "../src/lib/inicis/payment-audit";

const read = (relativePath: string) =>
  readFileSync(new URL(relativePath, import.meta.url), "utf8");

test("Inicis audit allowlist drops uppercase and nested secrets", () => {
  const audit = scrubInicisPaymentAudit({
    resultCode: "0000",
    MOID: "ORDER-1",
    TotPrice: "50000",
    P_TID: "TID-1",
    AUTH_TOKEN: "bearer-secret",
    authUrl: "https://inicis.example/approve?token=secret",
    merchantData: "callback-secret",
    signature: "signature-secret",
    approval: {
      resultMsg: "approved",
      P_CARD_NUM: "4111111111111111",
      P_BILL_KEY: "billing-secret",
      buyerEmail: "payer@example.com",
      address: "private address",
      AuthSignature: "nested-signature-secret",
    },
    signatureVerification: {
      sigVerified: true,
      verifyStatus: "verified",
      authSig: "masked-but-unnecessary",
      ourSig: "masked-but-unnecessary",
    },
  });
  const serialized = JSON.stringify(audit);
  assert.equal(audit.resultCode, "0000");
  assert.equal(audit.MOID, "ORDER-1");
  assert.equal(audit.TotPrice, "50000");
  assert.equal(audit.P_TID, "TID-1");
  assert.doesNotMatch(
    serialized,
    /bearer-secret|inicis\.example|callback-secret|signature-secret|411111|billing-secret|payer@example\.com|private address|masked-but-unnecessary/,
  );
  assert.deepEqual(audit.signatureVerification, {
    sigVerified: true,
    verifyStatus: "verified",
  });
});

test("payment audit migration backfills and continuously enforces privacy", () => {
  const migration = read(
    "../supabase/migrations/0084_payment_audit_privacy.sql",
  );
  assert.match(
    migration,
    /regexp_replace\(\s*lower\(v_key\),\s*'\[\^a-z0-9\]'/,
  );
  assert.doesNotMatch(migration, /'signature'\s*,/);
  for (const table of ["submission_payments", "karaoke_payments"]) {
    assert.match(
      migration,
      new RegExp(`update public\\.${table}[\\s\\S]*scrub_server_payment_raw_response`),
    );
  }
  assert.match(
    migration,
    /update public\.karaoke_requests[\s\S]*scrub_payment_audit_json/,
  );
  assert.match(
    migration,
    /p_value - array\['paymentGroup', 'closeState', 'paypalReturnState'\]/,
  );
  assert.match(migration, /enforce_submission_payment_audit_privacy/);
  assert.match(migration, /enforce_karaoke_payment_audit_privacy/);
  assert.match(migration, /enforce_karaoke_request_audit_privacy/);
  assert.match(
    migration,
    /drop policy if exists "Submission payments readable by owner or admin"/,
  );
  assert.match(
    migration,
    /drop policy if exists "Karaoke payments readable"/,
  );
});

test("submission callback persists only scrubbed gateway audit payloads", () => {
  const handler = read("../src/app/api/inicis/return/handler.ts");
  assert.match(handler, /const scrubbed = scrubInicisPaymentAudit\(raw \?\? params\)/);
  assert.match(
    handler,
    /raw_response: scrubInicisPaymentAudit\(\{[\s\S]*approval: authData/,
  );
  assert.match(handler, /const safeCancellation = scrubInicisPaymentAudit/);
  assert.doesNotMatch(handler, /raw_response:\s*authData/);
});
