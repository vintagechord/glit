export const INICIS_MOBILE_UNAVAILABLE_MESSAGE =
  "모바일 카드 결제를 아직 사용할 수 없습니다. 무통장 입금을 선택하거나 PC에서 카드 결제를 이용해주세요. 신청서는 그대로 보관됩니다.";

/** Shown when the INIpayMobile flow is configured: the page leaves for the
 * gateway and returns to the order list when the card payment finishes. */
export const INICIS_MOBILE_REDIRECT_MESSAGE =
  "모바일에서는 이니시스 모바일 결제 페이지로 이동합니다. 결제가 끝나면 주문내역으로 돌아옵니다.";

export const isInicisMobileDevice = (userAgent: string, maxTouchPoints = 0) =>
  /iphone|ipad|ipod|android|windows phone|mobile/i.test(userAgent) ||
  (/macintosh/i.test(userAgent) && maxTouchPoints > 1);

export const isInicisMobileRequest = (headers: Pick<Headers, "get">) =>
  headers.get("sec-ch-ua-mobile") === "?1" ||
  isInicisMobileDevice(headers.get("user-agent") ?? "");

export const getInicisMobileBrowser = () =>
  typeof window !== "undefined" &&
  isInicisMobileDevice(window.navigator.userAgent, window.navigator.maxTouchPoints);

// Device characteristics do not change during a checkout. These snapshots
// keep server rendering deterministic while checking iPad desktop mode too.
export const subscribeToInicisDevice = () => () => {};
export const getInicisServerDevice = () => false;
