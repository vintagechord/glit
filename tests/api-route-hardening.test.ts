import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { NextRequest } from "next/server";

import { POST as postVisitorChat } from "../src/app/api/chat/route";
import { POST as postSupportInquiry } from "../src/app/api/support/inquiries/route";
import { readBoundedJsonBody } from "../src/lib/request-body";
import { parseSubmissionDeletePayload } from "../src/lib/submission-delete-request";
import { decodeTrackToken } from "../src/lib/track-token";

const read = (relativePath: string) =>
  readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");

test("malformed percent-encoded tracking tokens resolve to not-found input", () => {
  assert.equal(decodeTrackToken("valid-track-token"), "valid-track-token");
  assert.equal(decodeTrackToken("valid%2Dtrack%2Dtoken"), "valid-track-token");
  assert.equal(decodeTrackToken("%E0%A4%A"), null);
  assert.equal(decodeTrackToken("short"), null);

  const page = read("src/app/track/[token]/page.tsx");
  assert.match(page, /decodeTrackToken\(resolvedParams\.token\)/);
  assert.doesNotMatch(page, /decodeURIComponent\(resolvedParams\.token/);
  assert.match(
    page,
    /\.is\("user_id", null\)\s*\.eq\("guest_token", value\)/,
  );

  const validateRoute = read("src/app/api/track/validate/route.ts");
  assert.match(
    validateRoute,
    /\.is\("user_id", null\)\s*\.eq\("guest_token", token\)/,
  );
});

test("submission delete payload accepts only one to 100 UUID values", () => {
  const first = "11111111-1111-4111-8111-111111111111";
  const second = "22222222-2222-4222-8222-222222222222";
  assert.deepEqual(parseSubmissionDeletePayload({ ids: [first, first, second] }), {
    ids: [first, second],
  });
  assert.equal(parseSubmissionDeletePayload({ ids: [] }), null);
  assert.equal(parseSubmissionDeletePayload({ ids: ["not-a-uuid"] }), null);
  assert.equal(
    parseSubmissionDeletePayload({ ids: Array.from({ length: 101 }, () => first) }),
    null,
  );
  assert.equal(parseSubmissionDeletePayload({ ids: [first], extra: true }), null);
});

test("bounded JSON parser rejects invalid and chunked oversized bodies", async () => {
  const valid = await readBoundedJsonBody(
    new Request("https://example.test", {
      method: "POST",
      body: JSON.stringify({ ok: true }),
    }),
    128,
  );
  assert.deepEqual(valid, { ok: true, value: { ok: true } });

  const invalid = await readBoundedJsonBody(
    new Request("https://example.test", { method: "POST", body: "{" }),
    128,
  );
  assert.deepEqual(invalid, { ok: false, reason: "invalid" });

  const oversized = await readBoundedJsonBody(
    new Request("https://example.test", {
      method: "POST",
      body: JSON.stringify({ body: "x".repeat(256) }),
    }),
    64,
  );
  assert.deepEqual(oversized, { ok: false, reason: "too_large" });
});

test("admin JSON mutations authenticate before bounded body parsing", () => {
  const source = read("src/app/api/admin/submission-files/route.ts");
  const authIndex = source.indexOf("await requireAdminForApi()");
  const bodyIndex = source.indexOf("await readBoundedJsonBody(");
  assert.ok(authIndex >= 0);
  assert.ok(bodyIndex > authIndex);
  assert.doesNotMatch(source, /request\.json\(/);
});

test("new guest drafts reject caller-chosen low-entropy ownership tokens", () => {
  const source = read("src/app/api/submissions/draft/route.ts");
  assert.match(source, /guestToken: z\.string\(\)\.uuid\(\)\.optional\(\)/);
  assert.match(source, /namespace: "submission-draft-create-ip"/);
  assert.match(source, /readBoundedJsonBody\(request, 8 \* 1024\)/);
});

test("submission ownership is constrained in the service-role query", () => {
  const source = read("src/lib/payments/submission.ts");
  const ensureSource = source.slice(
    source.indexOf("export const ensureSubmissionOwner"),
    source.indexOf("export const createSubmissionPaymentOrder"),
  );
  const ownerLookupSource = source.slice(
    source.indexOf("const findSubmissionForOwner"),
    source.indexOf("export const ensureSubmissionOwner"),
  );

  assert.doesNotMatch(ensureSource, /findSubmissionById\(/);
  assert.match(ownerLookupSource, /\.eq\("user_id", owner\.userId\)/);
  assert.match(ownerLookupSource, /\.is\("user_id", null\)/);
  assert.match(ownerLookupSource, /\.eq\("guest_token", owner\.guestToken\)/);
});

test("member payment page reads the submission through owner-scoped RLS", () => {
  const source = read("src/app/dashboard/pay/[id]/page.tsx");

  assert.doesNotMatch(source, /createAdminClient/);
  assert.match(source, /if \(!user\) \{\s*redirect\(/);
  assert.match(source, /await supabase\s*\.from\("submissions"\)/);
  assert.match(source, /\.eq\("user_id", user\.id\)/);
});

test("guest cart and draft service queries include supplied bearer tokens", () => {
  for (const path of [
    "src/app/api/cart/items/route.ts",
    "src/app/api/cart/bank/route.ts",
    "src/app/api/submissions/drafts/route.ts",
  ]) {
    const source = read(path);
    assert.match(source, /\.is\("user_id", null\)/, path);
    assert.match(source, /\.in\("guest_token", guestTokens\)/, path);
    assert.match(source, /consumeRateLimit/, path);
    assert.match(source, /"Retry-After"/, path);
  }

  const singleDraftRoute = read("src/app/api/submissions/draft/route.ts");
  assert.match(
    singleDraftRoute,
    /\.is\("user_id", null\)\s*\.eq\("guest_token", params\.guestToken\)/,
  );
});

test("payment-method mutation is bounded, owner checked and rate limited", () => {
  const source = read("src/app/api/submissions/[id]/payment-method/route.ts");

  assert.match(source, /readBoundedJsonBody\(request, 8 \* 1024\)/);
  assert.match(source, /ensureSubmissionOwner/);
  assert.match(source, /namespace: "submission-payment-method-ip"/);
  assert.match(source, /"Retry-After"/);
});

test("logout uses the canonical origin and an internal-only redirect path", () => {
  const source = read("src/app/logout/route.ts");

  assert.match(source, /getSafeInternalPath/);
  assert.match(source, /getBaseUrl\(request\)/);
  assert.doesNotMatch(source, /headers\.get\("origin"\)/);
  assert.doesNotMatch(source, /new URL\(request\.url\)\.origin/);
});

test("public support writes have shared rate limiting and body caps", () => {
  for (const [path, namespace] of [
    ["src/app/api/chat/route.ts", "support-chat-write"],
    ["src/app/api/support/inquiries/route.ts", "support-inquiry-write"],
  ] as const) {
    const source = read(path);
    assert.match(source, new RegExp(`namespace: "${namespace}"`), path);
    assert.match(source, /readBoundedJsonBody/, path);
    assert.match(source, /status: 429/, path);
    assert.match(source, /"Retry-After"/, path);
    assert.match(source, /status: body\.reason === "too_large" \? 413 : 400/, path);
  }
});

test("new visitor chat clients keep access tokens out of request URLs", () => {
  const route = read("src/app/api/chat/route.ts");
  const widget = read("src/components/chatbot-widget.tsx");
  assert.match(route, /headers\.get\("x-support-chat-token"\)/);
  assert.match(route, /headers\.get\("x-support-chat-tokens"\)/);
  assert.match(widget, /"X-Support-Chat-Token": token/);
  assert.match(widget, /"X-Support-Chat-Tokens": requestTokens\.join\(","\)/);
  assert.doesNotMatch(widget, /params\.append\("accessToken"/);
  assert.doesNotMatch(widget, /URLSearchParams\(\{ accessToken: token \}\)/);
  assert.match(widget, /method: "PATCH"/);
  assert.match(widget, /JSON\.stringify\(\{ accessToken: token \}\)/);
});

test("chat GET handlers are read-only and mark-read uses PATCH", () => {
  const visitorRoute = read("src/app/api/chat/route.ts");
  const visitorGet = visitorRoute.slice(
    visitorRoute.indexOf("export async function GET"),
    visitorRoute.indexOf("export async function PATCH"),
  );
  assert.doesNotMatch(visitorGet, /\.update\(/);
  assert.match(visitorRoute, /export async function PATCH/);
  assert.match(visitorRoute, /\.eq\("access_token", parsed\.data\.accessToken\)/);

  const adminRoute = read("src/app/api/admin/chat/route.ts");
  const adminGet = adminRoute.slice(
    adminRoute.indexOf("export async function GET"),
    adminRoute.indexOf("export async function POST"),
  );
  assert.doesNotMatch(adminGet, /\.update\(/);
});

test("public support routes reject oversized streams before service-role writes", async () => {
  const oversizedBody = JSON.stringify({ body: "x".repeat(20 * 1024) });
  const chatResponse = await postVisitorChat(
    new NextRequest("https://example.test/api/chat", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-real-ip": "203.0.113.101",
      },
      body: oversizedBody,
    }),
  );
  assert.equal(chatResponse.status, 413);

  const inquiryResponse = await postSupportInquiry(
    new Request("https://example.test/api/support/inquiries", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-real-ip": "203.0.113.102",
      },
      body: oversizedBody,
    }),
  );
  assert.equal(inquiryResponse.status, 413);
});

test("support inquiry route returns Retry-After after its write limit", async () => {
  let response: Response | null = null;
  for (let index = 0; index < 6; index += 1) {
    response = await postSupportInquiry(
      new Request("https://example.test/api/support/inquiries", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-real-ip": "203.0.113.103",
        },
        body: "{}",
      }),
    );
  }

  assert.equal(response?.status, 429);
  assert.ok(Number(response?.headers.get("retry-after")) >= 1);
});
