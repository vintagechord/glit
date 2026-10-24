type KakaoConfiguration =
  | { ok: true; endpoint: string; apiKey: string; templateCode: string }
  | { ok: false; diagnostic: string };

/** Both supported aliases share the same validation in sending and readiness. */
export function getKakaoConfiguration(
  env: Record<string, string | undefined> = process.env,
): KakaoConfiguration {
  const endpoint = env.KAKAO_ALIMTALK_WEBHOOK_URL?.trim() ||
    env.KAKAO_NOTIFICATION_WEBHOOK_URL?.trim() || "";
  if (!endpoint) {
    return { ok: false, diagnostic: "missing: KAKAO_ALIMTALK_WEBHOOK_URL or KAKAO_NOTIFICATION_WEBHOOK_URL" };
  }
  try {
    const url = new URL(endpoint);
    if (
      url.protocol !== "https:" || url.username || url.password
    ) throw new Error("invalid webhook");
  } catch {
    // A webhook URL can contain credentials. Never echo it in logs or probes.
    return { ok: false, diagnostic: "Kakao notification webhook must be a valid HTTPS URL without embedded credentials." };
  }
  return {
    ok: true,
    endpoint,
    apiKey: env.KAKAO_ALIMTALK_API_KEY?.trim() || env.KAKAO_NOTIFICATION_API_KEY?.trim() || "",
    templateCode: env.KAKAO_ALIMTALK_TEMPLATE_CODE?.trim() || "ONSIDE_OFFICIAL_NOTICE",
  };
}
