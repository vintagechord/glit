export const APP_CONFIG = {
  supportEmail: process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? "onside17@daum.net",
  bankName: process.env.NEXT_PUBLIC_BANK_NAME ?? "신한은행",
  bankAccount: process.env.NEXT_PUBLIC_BANK_ACCOUNT ?? "123-456-789012",
  bankHolder: process.env.NEXT_PUBLIC_BANK_HOLDER ?? "온사이드",
  preReviewPriceKrw: Number(process.env.NEXT_PUBLIC_PRE_REVIEW_PRICE ?? "0"),
  uploadMaxMb: Number(process.env.NEXT_PUBLIC_UPLOAD_MAX_MB ?? "200"),
};
