import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (relativePath: string) => readFileSync(new URL(relativePath, import.meta.url), "utf8");
const sql = read("../supabase/migrations/20261126120000_uncertain_payment_inicis_inquiry.sql");
const body = sql.match(/create function public\.resolve_uncertain_submission_payment\([\s\S]*?\$\$;/)?.[0] ?? "";

test("an uncertain card approval is recorded only with matching Inicis inquiry evidence", () => {
  assert.ok(body, "resolve_uncertain_submission_payment is redefined");
  // The old signature without evidence is gone, so no caller can skip the lookup.
  assert.match(sql, /drop function if exists public\.resolve_uncertain_submission_payment\(text,uuid,text,text,text\);/);
  assert.match(body, /p_gateway_evidence jsonb default null/);
  assert.match(body, /p_outcome='APPROVED' and \(p_gateway_evidence is null[\s\S]*?'GATEWAY_EVIDENCE_REQUIRED'/);
  for (const check of [
    /p_gateway_evidence->>'source' is distinct from 'INIAPI_V2_INQUIRY'/,
    /p_gateway_evidence->>'tid' is distinct from btrim\(p_pg_tid\)/,
    /p_gateway_evidence->>'oid' is distinct from p\.order_id/,
    /p_gateway_evidence->>'status' is distinct from 'APPROVED'/,
    /evidence_price is distinct from p\.amount_krw::bigint/,
  ]) assert.match(body, check);
  // The price is cast only after it is known to be digits.
  assert.match(body, /case when \(p_gateway_evidence->>'priceKrw'\) ~ '\^\[0-9\]\{1,12\}\$'\s+then \(p_gateway_evidence->>'priceKrw'\)::bigint end/);
  // Evidence is checked against the locked attempt, before anything is written.
  const locked = body.indexOf("for update;");
  const mismatch = body.indexOf("'GATEWAY_EVIDENCE_MISMATCH'");
  assert.ok(locked > 0 && locked < mismatch);
  assert.ok(mismatch < body.indexOf("set result_code='ADMIN_RECONCILED'"));
  assert.ok(mismatch < body.indexOf("approve_submission_payment_order("));
  // What Inicis answered is kept on the attempt, under keys the audit privacy trigger keeps.
  assert.match(body, /audit := audit \|\| jsonb_build_object\('approval', jsonb_strip_nulls\(jsonb_build_object\(\s*'kind', 'INIAPI_V2_INQUIRY'/);
  const kept = body.slice(body.indexOf("'approval', jsonb_strip_nulls"), body.indexOf("'at', p_gateway_evidence->>'checkedAt'"));
  for (const key of ["kind", "phase", "tid", "moid", "mid", "price", "status", "paymethod", "applDate"]) assert.match(kept, new RegExp(`'${key}', `));
  // Server-only, pinned search_path.
  assert.match(body, /security invoker set search_path=public/);
  assert.match(sql, /revoke all on function public\.resolve_uncertain_submission_payment\(text,uuid,text,text,text,jsonb\) from public,anon,authenticated;/);
  assert.match(sql, /grant execute on function public\.resolve_uncertain_submission_payment\(text,uuid,text,text,text,jsonb\) to service_role;/);
});

test("the admin action looks the TID up at Inicis before calling the reconciliation RPC", () => {
  const helper = read("../src/lib/admin/order-payment.ts");
  const resolver = helper.slice(helper.indexOf("export async function resolveUncertainCardPayment"));
  assert.ok(resolver.indexOf("inquireInicisTransaction") < resolver.indexOf('db.rpc("resolve_uncertain_submission_payment"'));
  assert.match(resolver, /verifyInicisApprovalForOrder\(inquiry\.transaction/);
  assert.match(resolver, /p_gateway_evidence: gatewayEvidence/);
});
