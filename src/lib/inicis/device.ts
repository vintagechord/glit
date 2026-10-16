export const INICIS_MOBILE_UNAVAILABLE_MESSAGE =
  "카드 결제는 PC에서 이용해주세요. 모바일에서는 무통장 입금을 선택할 수 있습니다. 신청서는 그대로 보관됩니다.";

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
