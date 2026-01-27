const DEFAULT_LOGO =
  "https://rwysjsmxtpuqekeltwxi.supabase.co/storage/v1/object/public/logo/onside_logo.svg";

export const APP_CONFIG = {
  logoPath: process.env.NEXT_PUBLIC_LOGO_PATH ?? DEFAULT_LOGO,
  logoLightPath:
    process.env.NEXT_PUBLIC_LOGO_LIGHT_PATH ?? DEFAULT_LOGO,
  logoDarkPath:
    process.env.NEXT_PUBLIC_LOGO_DARK_PATH ?? DEFAULT_LOGO,
  supportEmail: process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? "help@vhouse.co.kr",
  supportPhone: process.env.NEXT_PUBLIC_SUPPORT_PHONE ?? "010-8436-9035",
  supportHours:
    process.env.NEXT_PUBLIC_SUPPORT_HOURS ?? "10:00 ~ 18:00 (주말/공휴일 휴무)",
  bankName: process.env.NEXT_PUBLIC_BANK_NAME ?? "국민은행",
  bankAccount: process.env.NEXT_PUBLIC_BANK_ACCOUNT ?? "073001-04-276967",
  bankHolder: process.env.NEXT_PUBLIC_BANK_HOLDER ?? "주식회사 빈티지하우스",
  bankLink: process.env.NEXT_PUBLIC_BANK_LINK ?? "",
  businessName: process.env.NEXT_PUBLIC_BUSINESS_NAME ?? "빈티지하우스(Vintage House)",
  businessRep: process.env.NEXT_PUBLIC_BUSINESS_REP ?? "정준영",
  businessAddress:
    process.env.NEXT_PUBLIC_BUSINESS_ADDRESS ??
    "경기도 김포시 사우중로74번길 29 시그마프라자 7층 빈티지하우스",
  businessRegNo:
    process.env.NEXT_PUBLIC_BUSINESS_REG_NO ?? "748-88-01472",
  businessMailOrderNo:
    process.env.NEXT_PUBLIC_BUSINESS_MAIL_ORDER_NO ?? "2023-경기김포-1524",
  privacyOfficer: process.env.NEXT_PUBLIC_PRIVACY_OFFICER ?? "정준영",
  hostingProvider:
    process.env.NEXT_PUBLIC_HOSTING_PROVIDER ?? "(주)가비아인터넷서비스",
  preReviewPriceKrw: Number(process.env.NEXT_PUBLIC_PRE_REVIEW_PRICE ?? "0"),
  uploadMaxMb: Number(
    process.env.NEXT_PUBLIC_UPLOAD_MAX_MB ??
    process.env.NEXT_PUBLIC_AUDIO_UPLOAD_MAX_MB ??
    "1024",
  ),
  karaokeFeeKrw: Number(process.env.NEXT_PUBLIC_KARAOKE_FEE ?? "50000"),
};
