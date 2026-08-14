export type GatewayPaymentBindingError =
  | "ORDER_ID_MISSING"
  | "ORDER_ID_MISMATCH"
  | "EXPECTED_AMOUNT_INVALID"
  | "APPROVED_AMOUNT_INVALID"
  | "AMOUNT_MISMATCH";

export const validateGatewayPaymentBinding = ({
  expectedOrderId,
  approvedOrderId,
  expectedAmount,
  approvedAmount,
}: {
  expectedOrderId: string;
  approvedOrderId?: string | null;
  expectedAmount: number;
  approvedAmount: number;
}): GatewayPaymentBindingError | null => {
  const expectedOrder = expectedOrderId.trim();
  const approvedOrder = approvedOrderId?.trim() ?? "";
  if (!approvedOrder) return "ORDER_ID_MISSING";
  if (!expectedOrder || approvedOrder !== expectedOrder) {
    return "ORDER_ID_MISMATCH";
  }
  if (!Number.isFinite(expectedAmount) || expectedAmount <= 0) {
    return "EXPECTED_AMOUNT_INVALID";
  }
  if (!Number.isFinite(approvedAmount) || approvedAmount <= 0) {
    return "APPROVED_AMOUNT_INVALID";
  }
  if (approvedAmount !== expectedAmount) return "AMOUNT_MISMATCH";
  return null;
};
