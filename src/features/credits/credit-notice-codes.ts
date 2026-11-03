/**
 * /magazine and /mypage/credits show ?error= as an official notice. The value
 * used to be rendered as given, so a crafted link could display any sentence
 * (a fake bank account, say) on the site. Redirects now send one of these
 * codes; the pages show the fixed message and ignore anything else.
 */
const creditNoticeErrors = {
  reservation_required: {
    ko: "서비스 이용 요청은 이용 희망일과 연락처를 입력해 접수해주세요.",
    en: "Enter your preferred date and contact details to request this service.",
  },
  invalid_reservation: {
    ko: "이용 희망일, 시간, 신청자명, 연락처를 확인해주세요.",
    en: "Check the preferred date, time, name and contact details.",
  },
  login_required: {
    ko: "로그인 후 서비스 이용 요청을 접수할 수 있습니다.",
    en: "Log in to request this service.",
  },
  reward_not_found: {
    ko: "신청 가능한 서비스를 찾을 수 없습니다.",
    en: "This service is not available for requests.",
  },
  insufficient_credits: {
    ko: "보유 크레딧이 부족합니다.",
    en: "You do not have enough credits.",
  },
  invalid_reservation_date: {
    ko: "이용 희망일은 오늘 이후 날짜로 선택해주세요.",
    en: "Choose a preferred date after today.",
  },
  invalid_reservation_time: {
    ko: "이용 희망 시간을 다시 선택해주세요.",
    en: "Choose the preferred time again.",
  },
  reservation_failed: {
    ko: "서비스 이용 요청 접수에 실패했습니다.",
    en: "We could not submit the service request.",
  },
} as const;

export type CreditNoticeErrorCode = keyof typeof creditNoticeErrors;

/** The fixed message for a known code, or null for anything else. */
export const creditNoticeErrorMessage = (value: string | string[] | undefined, localePrefix = "") => {
  const code = Array.isArray(value) ? value[0] : value;
  if (!code || !Object.hasOwn(creditNoticeErrors, code)) return null;
  const message = creditNoticeErrors[code as CreditNoticeErrorCode];
  return localePrefix === "/en" ? message.en : message.ko;
};

/** Maps a redeem_studio_reward error to a notice code. */
export const studioRewardErrorCode = (message?: string | null): CreditNoticeErrorCode => {
  const raw = message ?? "";
  if (raw.includes("LOGIN_REQUIRED")) return "login_required";
  if (raw.includes("REWARD_NOT_FOUND")) return "reward_not_found";
  if (raw.includes("INSUFFICIENT_CREDITS")) return "insufficient_credits";
  if (raw.includes("INVALID_RESERVATION_DATE")) return "invalid_reservation_date";
  if (raw.includes("INVALID_RESERVATION_TIME")) return "invalid_reservation_time";
  return "reservation_failed";
};
