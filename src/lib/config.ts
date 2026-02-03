const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");

const PUBLIC_LOGO_BASE = SUPABASE_URL
  ? `${SUPABASE_URL}/storage/v1/object/public/logo`
  : undefined;

const PUBLIC_LOGO_LIGHT = PUBLIC_LOGO_BASE
  ? `${PUBLIC_LOGO_BASE}/onside-logo-light.svg`
  : undefined;

const PUBLIC_LOGO_DARK = PUBLIC_LOGO_BASE
  ? `${PUBLIC_LOGO_BASE}/onside-logo-dark.svg`
  : undefined;

const PUBLIC_LOGO_FALLBACK = PUBLIC_LOGO_BASE
  ? `${PUBLIC_LOGO_BASE}/onside_logo.svg`
  : undefined;

// Long-lived signed URL kept as a final fallback to avoid broken branding when
// env vars are missing or the bucket is private.
const DEFAULT_SIGNED_LOGO =
  "https://rwysjsmxtpuqekeltwxi.supabase.co/storage/v1/object/sign/logo/onside_logo.svg?token=eyJraWQiOiJzdG9yYWdlLXVybC1zaWduaW5nLWtleV8xMDAwNTc4YS0wOTBiLTRmOTYtYTRlMC1mNTM5ODlhNjRjMDgiLCJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJsb2dvL29uc2lkZV9sb2dvLnN2ZyIsImlhdCI6MTc2OTUzNzI0NiwiZXhwIjoyMDg0ODk3MjQ2fQ.b_hTQcgrSOHS0u5nn0mcJbIy5xwFytJY-st0_6UKijY";

const DEFAULT_SIGNED_LOGO_LIGHT =
  "https://rwysjsmxtpuqekeltwxi.supabase.co/storage/v1/object/sign/logo/onside-logo-light.svg?token=eyJraWQiOiJzdG9yYWdlLXVybC1zaWduaW5nLWtleV8xMDAwNTc4YS0wOTBiLTRmOTYtYTRlMC1mNTM5ODlhNjRjMDgiLCJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJsb2dvL29uc2lkZS1sb2dvLWxpZ2h0LnN2ZyIsImlhdCI6MTc3MDEyMTM5MSwiZXhwIjoyMDg1NDgxMzkxfQ.pVNc81TMLP0AuP_Cew8q_bqCEBBo_78IRYyrTZRld2w";

const DEFAULT_SIGNED_LOGO_DARK =
  "https://rwysjsmxtpuqekeltwxi.supabase.co/storage/v1/object/sign/logo/onside-logo-dark.svg?token=eyJraWQiOiJzdG9yYWdlLXVybC1zaWduaW5nLWtleV8xMDAwNTc4YS0wOTBiLTRmOTYtYTRlMC1mNTM5ODlhNjRjMDgiLCJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJsb2dvL29uc2lkZS1sb2dvLWRhcmsuc3ZnIiwiaWF0IjoxNzcwMTIxMzY2LCJleHAiOjIwODU0ODEzNjZ9.S2DdfforrelUeNcrtcVIvh1iJuUxTYTSSkz5opI_tDQ";

export const APP_CONFIG = {
  logoPath:
    process.env.NEXT_PUBLIC_LOGO_PATH ??
    PUBLIC_LOGO_FALLBACK ??
    DEFAULT_SIGNED_LOGO,
  logoLightPath:
    process.env.NEXT_PUBLIC_LOGO_LIGHT_PATH ??
    PUBLIC_LOGO_LIGHT ??
    DEFAULT_SIGNED_LOGO_LIGHT ??
    PUBLIC_LOGO_FALLBACK ??
    DEFAULT_SIGNED_LOGO,
  logoDarkPath:
    process.env.NEXT_PUBLIC_LOGO_DARK_PATH ??
    PUBLIC_LOGO_DARK ??
    DEFAULT_SIGNED_LOGO_DARK ??
    PUBLIC_LOGO_FALLBACK ??
    "",
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
