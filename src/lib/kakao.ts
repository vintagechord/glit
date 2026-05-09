type KakaoNotificationPayload = {
  phone?: string | null;
  title: string;
  message: string;
  link?: string | null;
  templateCode?: string;
};

type KakaoSendResult = {
  ok: boolean;
  skipped?: boolean;
  message?: string;
};

const normalizePhone = (value?: string | null) =>
  (value ?? "").replace(/[^0-9]/g, "");

export async function sendKakaoOfficialNotification(
  payload: KakaoNotificationPayload,
): Promise<KakaoSendResult> {
  const endpoint =
    process.env.KAKAO_ALIMTALK_WEBHOOK_URL ??
    process.env.KAKAO_NOTIFICATION_WEBHOOK_URL;
  const apiKey =
    process.env.KAKAO_ALIMTALK_API_KEY ??
    process.env.KAKAO_NOTIFICATION_API_KEY;
  const phone = normalizePhone(payload.phone);

  if (!endpoint || !phone) {
    return { ok: false, skipped: true };
  }

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        to: phone,
        title: payload.title,
        message: payload.message,
        link: payload.link ?? undefined,
        templateCode:
          payload.templateCode ??
          process.env.KAKAO_ALIMTALK_TEMPLATE_CODE ??
          "ONSIDE_OFFICIAL_NOTICE",
      }),
    });

    if (!response.ok) {
      return {
        ok: false,
        skipped: false,
        message: "카카오톡 알림 발송에 실패했습니다.",
      };
    }

    return { ok: true };
  } catch (error) {
    console.error("[kakao][official][send-error]", error);
    return {
      ok: false,
      skipped: false,
      message: "카카오톡 알림 발송에 실패했습니다.",
    };
  }
}
