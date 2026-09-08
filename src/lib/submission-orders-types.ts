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
  items: SubmissionOrderItem[];
  canReturnToCart: boolean;
};

export type SubmissionOrdersPage = {
  orders: SubmissionOrder[];
  nextOffset: number | null;
};
