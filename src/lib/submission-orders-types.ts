import type { CashReceiptSummary } from "@/lib/cash-receipts";

export type SubmissionOrderStatus =
  | "BANK_PENDING"
  | "CARD_PENDING"
  | "PAYPAL_PENDING"
  | "PAID"
  | "FAILED"
  | "CANCELED"
  | "REFUNDED"
  | "REVIEW_REQUIRED";

export type SubmissionOrderItem = {
  id: string;
  submissionId: string | null;
  submissionRef: string;
  type: string;
  title: string | null;
  artistName: string | null;
  packageName: string | null;
  amountKrw: number | null;
  amount: number | null;
  isOneclick: boolean;
};

export type SubmissionOrder = {
  id: string;
  paymentMethod: "BANK" | "CARD" | "PAYPAL";
  status: SubmissionOrderStatus;
  amountKrw: number | null;
  amount: number | null;
  currency: string;
  source: string;
  note: string | null;
  createdAt: string;
  updatedAt: string;
  paidAt: string | null;
  returnedAt: string | null;
  depositorName?: string | null;
  depositDueAt?: string | null;
  items: SubmissionOrderItem[];
  canReturnToCart: boolean;
  /** A card approval is unconfirmed (claim open, reconciliation pending or
   * REVIEW_REQUIRED): the customer may have been charged. */
  paymentChecking?: boolean;
  /** Placed as a guest; reached through this browser's guest proofs. */
  guestOrder?: boolean;
  cashReceipt?: CashReceiptSummary | null;
};

export type SubmissionOrdersPage = {
  orders: SubmissionOrder[];
  nextOffset: number | null;
};
