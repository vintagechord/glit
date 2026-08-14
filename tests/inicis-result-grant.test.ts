import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { GET as handleInicisClose } from "../src/app/api/inicis/close/route";
import { serializeInlineScriptJson } from "../src/lib/inline-script-json";

const read = (relativePath: string) =>
  readFileSync(new URL(relativePath, import.meta.url), "utf8");

const returnHandler = read("../src/app/api/inicis/return/handler.ts");
const returnBridge = read(
  "../src/app/(pay-popup)/pay/inicis/return/page.tsx",
);
const closeRoute = read("../src/app/api/inicis/close/route.ts");
const testCloseRoute = read("../src/app/api/inicis/test-100/close/route.ts");

test("Inicis redirect and postMessage payloads never expose a guest bearer token", () => {
  const bridgePayloadType = returnHandler.match(
    /type BridgePayload = \{[\s\S]*?\n\};/,
  )?.[0];
  const redirectBuilder = returnHandler.match(
    /const buildBridgeRedirect = \([\s\S]*?\n\};/,
  )?.[0];

  assert.ok(bridgePayloadType);
  assert.ok(redirectBuilder);
  assert.doesNotMatch(bridgePayloadType, /guestToken|guest_token/);
  assert.doesNotMatch(redirectBuilder, /guestToken|guest_token/);
  assert.doesNotMatch(
    returnHandler,
    /searchParams\.set\(["']guestToken["']/,
  );
  assert.doesNotMatch(
    redirectBuilder,
    /searchParams\.set\(["'](?:orderId|message|resultCode|tid|amount)["']/,
  );

  // The client bridge must not accept an injected guestToken query parameter,
  // reflect one through postMessage, or build a long-lived /track/<token> URL.
  assert.doesNotMatch(returnBridge, /guestToken|guest_token/);
  assert.doesNotMatch(returnBridge, /\/track\/\$\{/);
  assert.doesNotMatch(
    returnBridge,
    /searchParams\.get\(["'](?:orderId|message|resultCode|tid|amount)["']/,
  );

  const closePostMessageBuilder = closeRoute.match(
    /const postMessageResponse = \([\s\S]*?\n\};/,
  )?.[0];
  assert.ok(closePostMessageBuilder);
  assert.doesNotMatch(closePostMessageBuilder, /guestToken|guest_token/);
  assert.doesNotMatch(closeRoute, /payloadData\.guestToken/);
});

test("Inicis grants are issued only after gateway binding, never for known-oid failures", () => {
  assert.match(returnHandler, /createPaymentResultGrant\(\{[\s\S]*provider: "inicis"/);
  assert.match(returnHandler, /setPaymentResultGrantCookie\(response, grant\)/);
  assert.match(
    returnHandler,
    /const buildVerifiedGuestBridgeRedirect = \([\s\S]*!callbackStateVerified[\s\S]*!approvalSignatureVerified[\s\S]*return response;/,
  );
  assert.equal(
    returnHandler.match(
      /approval\.ok && localSigMatch === true/g,
    )?.length,
    2,
  );

  const verifiedRedirectCalls = Array.from(
    returnHandler.matchAll(/return buildVerifiedGuestBridgeRedirect\(/g),
  ).map((match) => match.index);
  assert.equal(
    verifiedRedirectCalls.length,
    2,
    "only verified success and post-approval persistence failure may issue a grant",
  );

  const bindingIndex = returnHandler.indexOf(
    "const bindingError = validateGatewayPaymentBinding",
  );
  const successPayloadIndex = returnHandler.indexOf("const successPayload = {");
  assert.ok(bindingIndex >= 0);
  assert.ok(successPayloadIndex > bindingIndex);
  assert.ok(
    verifiedRedirectCalls.every((index) => index > successPayloadIndex),
    "every grant-setting redirect must occur after exact gateway order/amount binding",
  );

  const alreadyApprovedStart = returnHandler.indexOf("if (alreadyApproved");
  const terminalGuardStart = returnHandler.indexOf(
    "if (paymentStatus && !canHandlePaymentApprovalCallback(paymentStatus))",
  );
  const saveFailureStart = returnHandler.indexOf("const saveFailure = async");
  assert.ok(alreadyApprovedStart >= 0);
  assert.ok(terminalGuardStart > alreadyApprovedStart);
  assert.ok(saveFailureStart > terminalGuardStart);
  assert.doesNotMatch(
    returnHandler.slice(alreadyApprovedStart, saveFailureStart),
    /return buildVerifiedGuestBridgeRedirect/,
  );
  assert.match(
    returnHandler.slice(alreadyApprovedStart, saveFailureStart),
    /return buildBridgeRedirect\(baseUrl/,
  );

  assert.match(
    closeRoute,
    /submissionResult\.ok[\s\S]*createPaymentResultGrant\(\{[\s\S]*provider: "inicis"/,
  );
  assert.match(closeRoute, /setPaymentResultGrantCookie\(response, paymentResultGrant\)/);
});

test("Inicis close bridge cannot be escaped through inline JSON", async () => {
  const dangerous = "</script><script>globalThis.pwned=true</script>&\u2028\u2029";
  const serialized = serializeInlineScriptJson({ dangerous });
  assert.doesNotMatch(serialized, /[<>&\u2028\u2029]/u);
  assert.match(serialized, /\\u003c\/script\\u003e/);

  const state = "11111111-1111-4111-8111-111111111111";
  const response = await handleInicisClose(
    new Request(
      `https://example.test/api/inicis/close?oid=${encodeURIComponent(dangerous)}&state=${state}`,
    ),
  );
  const html = await response.text();
  assert.equal((html.match(/<\/script>/gi) ?? []).length, 1);
  assert.doesNotMatch(html, /globalThis\.pwned|dangerous/);
  assert.match(closeRoute, /const orderIdPattern = \^?\/\^\[A-Za-z0-9_/);
  assert.match(closeRoute, /serializeInlineScriptJson/);
  assert.match(testCloseRoute, /serializeInlineScriptJson/);
});
