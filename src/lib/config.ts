export const APP_CONFIG = {
  logoPath: process.env.NEXT_PUBLIC_LOGO_PATH ?? "/brand/onside-logo.svg",
  supportEmail: process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? "onside17@daum.net",
  supportPhone: process.env.NEXT_PUBLIC_SUPPORT_PHONE ?? "010-5556-7083",
  supportHours:
    process.env.NEXT_PUBLIC_SUPPORT_HOURS ?? "09:00 ~ 18:00 (주말/공휴일 휴무)",
  bankName: process.env.NEXT_PUBLIC_BANK_NAME ?? "국민은행",
  bankAccount: process.env.NEXT_PUBLIC_BANK_ACCOUNT ?? "351901-04-227106",
  bankHolder: process.env.NEXT_PUBLIC_BANK_HOLDER ?? "송재현(영모에버)",
  bankLink: process.env.NEXT_PUBLIC_BANK_LINK ?? "",
  businessName: process.env.NEXT_PUBLIC_BUSINESS_NAME ?? "온사이드",
  businessRep: process.env.NEXT_PUBLIC_BUSINESS_REP ?? "정근영",
  businessAddress:
    process.env.NEXT_PUBLIC_BUSINESS_ADDRESS ??
    "서울특별시 은평구 진흥로 37-6",
  businessRegNo:
    process.env.NEXT_PUBLIC_BUSINESS_REG_NO ?? "110-21-24454",
  businessMailOrderNo:
    process.env.NEXT_PUBLIC_BUSINESS_MAIL_ORDER_NO ?? "일반과세자",
  privacyOfficer: process.env.NEXT_PUBLIC_PRIVACY_OFFICER ?? "송재현",
  hostingProvider:
    process.env.NEXT_PUBLIC_HOSTING_PROVIDER ?? "(주)가비아인터넷서비스",
  preReviewPriceKrw: Number(process.env.NEXT_PUBLIC_PRE_REVIEW_PRICE ?? "0"),
  uploadMaxMb: Number(process.env.NEXT_PUBLIC_UPLOAD_MAX_MB ?? "200"),
};
