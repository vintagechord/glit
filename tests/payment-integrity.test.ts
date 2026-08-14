import assert from "node:assert/strict";
import test from "node:test";

import { validateGatewayPaymentBinding } from "../src/lib/payment-integrity";

test("gateway approval is bound to the stored order and exact amount", () => {
  assert.equal(
    validateGatewayPaymentBinding({
      expectedOrderId: "ORDER-1",
      approvedOrderId: "ORDER-1",
      expectedAmount: 30000,
      approvedAmount: 30000,
    }),
    null,
  );
  assert.equal(
    validateGatewayPaymentBinding({
      expectedOrderId: "ORDER-1",
      approvedOrderId: "ORDER-2",
      expectedAmount: 30000,
      approvedAmount: 30000,
    }),
    "ORDER_ID_MISMATCH",
  );
  assert.equal(
    validateGatewayPaymentBinding({
      expectedOrderId: "ORDER-1",
      approvedOrderId: null,
      expectedAmount: 30000,
      approvedAmount: 30000,
    }),
    "ORDER_ID_MISSING",
  );
  assert.equal(
    validateGatewayPaymentBinding({
      expectedOrderId: "ORDER-1",
      approvedOrderId: "ORDER-1",
      expectedAmount: 30000,
      approvedAmount: 29999,
    }),
    "AMOUNT_MISMATCH",
  );
  assert.equal(
    validateGatewayPaymentBinding({
      expectedOrderId: "ORDER-1",
      approvedOrderId: "ORDER-1",
      expectedAmount: 30000,
      approvedAmount: 0,
    }),
    "APPROVED_AMOUNT_INVALID",
  );
});
