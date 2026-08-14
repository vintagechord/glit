import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  consumeInicisPopupHandoff,
  createInicisPopupHandoff,
} from "../src/lib/inicis/popup-handoff";

const read = (relativePath: string) =>
  readFileSync(new URL(relativePath, import.meta.url), "utf8");

const nonce = "11111111-1111-4111-8111-111111111111";
const submissionId = "22222222-2222-4222-8222-222222222222";
const guestToken = "33333333-3333-4333-8333-333333333333";

class MemoryStorage {
  readonly values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

test("mobile Inicis popup handoff is exact, short-lived, and single-use", () => {
  const storage = new MemoryStorage();
  const created = createInicisPopupHandoff(
    {
      context: "music",
      submissionId,
      submissionIds: [submissionId],
      guestToken,
      guestTokensBySubmissionId: { [submissionId]: guestToken },
    },
    { storage, nonce, now: 10_000 },
  );
  assert.equal(created, nonce);
  assert.deepEqual(
    consumeInicisPopupHandoff(nonce, { storage, now: 10_001 }),
    {
      context: "music",
      submissionId,
      submissionIds: [submissionId],
      guestToken,
      guestTokensBySubmissionId: { [submissionId]: guestToken },
    },
  );
  assert.equal(
    consumeInicisPopupHandoff(nonce, { storage, now: 10_002 }),
    null,
  );

  createInicisPopupHandoff(
    { context: "music", submissionId, guestToken },
    { storage, nonce, now: 10_000 },
  );
  assert.equal(
    consumeInicisPopupHandoff(nonce, {
      storage,
      now: 10_000 + 5 * 60 * 1000 + 1,
    }),
    null,
  );
  assert.equal(storage.values.size, 0);
});

test("popup navigation never serializes guest bearer tokens", () => {
  const popup = read("../src/lib/inicis/popup.ts");
  const client = read(
    "../src/app/(pay-popup)/pay/inicis/popup/client-page.tsx",
  );
  const proxy = read("../src/proxy.ts");
  const payPage = read("../src/app/dashboard/pay/[id]/page.tsx");
  const returnBridge = read(
    "../src/app/(pay-popup)/pay/inicis/return/page.tsx",
  );
  const returnHandler = read("../src/app/api/inicis/return/handler.ts");

  const buildStart = popup.indexOf("const buildPopupUrl");
  const buildEnd = popup.indexOf("const fetchStdPayInit", buildStart);
  const buildSource = popup.slice(buildStart, buildEnd);
  assert.match(buildSource, /createInicisPopupHandoff/);
  assert.match(buildSource, /\?handoff=/);
  assert.doesNotMatch(buildSource, /params\.set\(["']guestToken/);
  assert.doesNotMatch(buildSource, /params\.set\(["']guestTokens/);
  assert.doesNotMatch(client, /searchParams\.guestToken/);
  assert.doesNotMatch(client, /searchParams\.guestTokens/);
  assert.doesNotMatch(client, /rawParams/);
  assert.doesNotMatch(proxy, /searchParams\.get\(["']guestToken/);
  assert.doesNotMatch(payPage, /resolvedSearchParams\.guestToken/);
  assert.match(returnHandler, /submissionIds: paidSubmissionIds/);
  assert.match(
    returnBridge,
    /removeGuestSubmissionCartEntries\(payload\.submissionIds\)/,
  );
});
