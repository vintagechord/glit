import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { build } from "esbuild";

import {
  formatAttachmentSize,
  missingOriginalReason,
  originalMailAttachments,
  originalMailDocument,
} from "../src/lib/admin/email-original";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("the original keeps the body and makes every link target a blocked new window", () => {
  const fragment = '<div style="padding:8px"><a href="https://iamonside.com/track/code">진행상황</a></div>';
  const wrapped = originalMailDocument(fragment);
  assert.match(wrapped, /^<!doctype html><html><head><meta charset="utf-8"><base target="_blank"><\/head><body style="margin:0">/);
  assert.ok(wrapped.includes(fragment), "the stored body is shown unchanged");

  const full = '<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>t</title></head><body><a href="https://iamonside.com/">x</a></body></html>';
  const framed = originalMailDocument(full);
  assert.equal(framed.match(/<base target="_blank">/g)?.length, 1);
  assert.ok(framed.startsWith('<!doctype html><html lang="ko"><head><base target="_blank"><meta charset="utf-8">'));
  assert.equal(framed.replace('<base target="_blank">', ""), full);
});

test("a missing body explains sign-in mail and mail sent before bodies were kept", () => {
  assert.match(missingOriginalReason("password reset"), /보안/);
  assert.match(missingOriginalReason("signup verification"), /보안/);
  assert.match(missingOriginalReason("bank payment request"), /보관을 시작하기 전/);
});

test("attachment names and sizes come from the stored references only", () => {
  assert.deepEqual(originalMailAttachments([
    { kind: "certificate", filename: "HUG.pdf", bytes: 411918, objectKey: "private/key" },
    { filename: "", bytes: 1 }, null, "x",
    { filename: "rating.png", bytes: "11233" },
  ]), [{ filename: "HUG.pdf", bytes: 411918 }, { filename: "rating.png", bytes: null }]);
  assert.deepEqual(originalMailAttachments(null), []);
  assert.equal(formatAttachmentSize(411918), "402KB");
  assert.equal(formatAttachmentSize(2 * 1024 * 1024), "2.0MB");
  assert.equal(formatAttachmentSize(null), "");
});

test("the original page renders the body in a script-less sandbox and every mail list links to it", () => {
  const page = read("src/app/admin/emails/[id]/page.tsx");
  assert.match(page, /await requireAdminPage\(\);/);
  assert.match(page, /sandbox=""/);
  assert.match(page, /srcDoc=\{originalMailDocument\(mail\.html\)\}/);
  assert.match(read("src/app/admin/emails/page.tsx"), /href=\{`\/admin\/emails\/\$\{row\.id\}`\}/);
  assert.match(read("src/components/admin/review-email-control.tsx"), /href=\{`\/admin\/emails\/\$\{mail\.id\}`\}/);
  assert.match(read("src/components/admin/customer-activity-record.tsx"), /href=\{`\/admin\/emails\/\$\{mail\.id\}`\}/);
});

test("the outbox keeps delivered and expired bodies except sign-in links", () => {
  const migration = read("supabase/migrations/20261110120000_email_outbox_keep_sent_bodies.sql");
  const finish = migration.slice(migration.indexOf("function public.finish_email_outbox"));
  assert.match(finish, /html=case when next_status in \('accepted','expired'\)\s+and e\.operation in \('signup verification','password reset'\) then null else e\.html end/);
  const maintain = migration.slice(migration.indexOf("function public.maintain_email_outbox"), migration.indexOf("function public.finish_email_outbox"));
  assert.match(maintain, /html=case when operation in \('signup verification','password reset'\) then null else html end/);
  assert.match(maintain, /created_at < now\(\) - interval '30 days'/, "rows and bodies still go after 30 days");
  assert.match(migration, /grant execute on function public\.maintain_email_outbox\(\), public\.finish_email_outbox\(uuid,uuid,text,text,text,text,integer\) to service_role/);
});

test("the bank notice shows the cash receipt request escaped and is filed under an application", async () => {
  const built = await build({
    stdin: { contents: "export {sendOrderBankTransferEmail} from './src/lib/email';export {messages} from 'template-fixture';", resolveDir: process.cwd(), loader: "ts" },
    bundle: true, platform: "node", format: "cjs", packages: "external", write: false,
    plugins: [{ name: "template-infrastructure", setup(plugin) {
      plugin.onResolve({ filter: /^(template-fixture|@\/lib\/email-transport)$/ }, args => ({ path: args.path, namespace: "fixture" }));
      plugin.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({ loader: "js", contents: path === "template-fixture" ? "export const messages=[];" : "import {messages} from 'template-fixture';export const sendTransactionalEmail=async input=>{messages.push(input);return {ok:true}};" }));
    } }],
  });
  const loaded = { exports: {} as { sendOrderBankTransferEmail: (input: Record<string, unknown>) => Promise<unknown>; messages: Array<{ html: string; operation: string; submissionId?: string }> } };
  new Function("require", "module", "exports", built.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports);
  const input = {
    email: "member@example.invalid", orderId: "order-1", totalAmountKrw: 3500, depositorName: "홍길동",
    items: [{ title: "Title", artist: "Artist", kind: "ALBUM", amountKrw: 3500 }],
    link: "https://app.example.invalid/mypage/orders", submissionId: "sub-1",
  };
  await loaded.exports.sendOrderBankTransferEmail({ ...input, cashReceipt: { purposeLabel: "개인 소득공제용", identifierMasked: "010-****-<5678>" } });
  const [withReceipt] = loaded.exports.messages;
  assert.equal(withReceipt.operation, "bank payment request");
  assert.equal(withReceipt.submissionId, "sub-1");
  assert.match(withReceipt.html, /현금영수증 신청/);
  assert.match(withReceipt.html, /개인 소득공제용 · 010-\*\*\*\*-&lt;5678&gt;/);
  await loaded.exports.sendOrderBankTransferEmail({ ...input, cashReceipt: null });
  assert.doesNotMatch(loaded.exports.messages[1].html, /현금영수증 신청/);
});

test("staff see the order's cash receipt request in full on the application and the default receipts view", () => {
  const detail = read("src/app/admin/submissions/detail/page.tsx");
  assert.match(detail, /from\("submission_order_cash_receipts"\)\s+\.select\("purpose, identifier, status/);
  assert.match(detail, /formatCashReceiptIdentifier\(orderCashReceipt\.identifier\)/);
  assert.doesNotMatch(detail, /currentOrderId && \["PAID", "REFUNDED"\]\.includes/, "the request is shown before the deposit is confirmed");
  const receipts = read("src/app/admin/cash-receipts/page.tsx");
  assert.match(receipts, /: "open";/);
  assert.match(receipts, /\["open", "진행 중"\]/);
  assert.match(read("src/app/admin/page.tsx"), /현금영수증 \{CASH_RECEIPT_PURPOSE_LABELS\[order\.cashReceiptPurpose\]\}/);
});
