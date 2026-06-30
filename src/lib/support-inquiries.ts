export type SupportInquiryStatus = "NEW" | "REVIEWING" | "ANSWERED" | "CLOSED";

export type SupportInquiry = {
  id: string;
  userId: string | null;
  title: string;
  body: string;
  contact: string;
  status: SupportInquiryStatus;
  adminMemo: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export const supportInquiryStatusLabels: Record<SupportInquiryStatus, string> = {
  NEW: "신규 문의",
  REVIEWING: "확인 중",
  ANSWERED: "답변 완료",
  CLOSED: "종료",
};
