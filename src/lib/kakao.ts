import { getKakaoConfiguration } from "./kakao-config";

type KakaoNotificationPayload = {
  phone?: string | null;
  title: string;
  message: string;
  link?: string | null;
  templateCode?: string;
  idempotencyKey?: string;
};

type KakaoSendResult = {
  ok: boolean;
  skipped?: boolean;
  message?: string;
  messageId?: string;
};

const KAKAO_REQUEST_TIMEOUT_MS = 10_000;

const normalizePhone = (value?: string | null) =>
  (value ?? "").replace(/[^0-9]/g, "");

export async function sendKakaoOfficialNotification(
  payload: KakaoNotificationPayload,
): Promise<KakaoSendResult> {
  const config = getKakaoConfiguration();
  const phone = normalizePhone(payload.phone);

  if (!config.ok || !phone) {
    return { ok: false, skipped: true };
  }

  try {
    const response = await fetch(config.endpoint, {
      method: "POST",
      signal: AbortSignal.timeout(KAKAO_REQUEST_TIMEOUT_MS),
      headers: {
        "Content-Type": "application/json",
        ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
        ...(payload.idempotencyKey ? { "Idempotency-Key": payload.idempotencyKey } : {}),
      },
      body: JSON.stringify({
        to: phone,
        title: payload.title,
        message: payload.message,
        link: payload.link ?? undefined,
        templateCode:
          payload.templateCode ??
          config.templateCode,
      }),
    });

    if (!response.ok) {
      return {
        ok: false,
        skipped: false,
        message: "카카오톡 알림 발송에 실패했습니다.",
      };
    }

    const accepted = await response.json().catch(() => null) as { id?: unknown; messageId?: unknown } | null;
    const id = accepted?.messageId ?? accepted?.id;
    const messageId = typeof id === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(id) ? id : undefined;
    return { ok: true, ...(messageId ? { messageId } : {}) };
  } catch (error) {
    console.error("[kakao][official][send-error]", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return {
      ok: false,
      skipped: false,
      message: "카카오톡 알림 발송에 실패했습니다.",
    };
  }
}
