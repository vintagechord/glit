type WelcomeEmailPayload = {
  email: string;
  name?: string;
};

type SubmissionReceiptPayload = {
  email: string;
  title: string;
  kind: "ALBUM" | "MV";
  isGuest?: boolean;
  guestToken?: string;
  link?: string;
};

export async function sendWelcomeEmail(payload: WelcomeEmailPayload) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM;

  if (!apiKey || !from) {
    return { ok: false, skipped: true } as const;
  }

  const name = payload.name?.trim() || "GLIT";
  const body = {
    from,
    to: payload.email,
    subject: "Welcome to GLIT",
    html: `<p>Hi ${name},</p><p>Your release is now officially greenlit with GLIT.</p><p>Submit, track, and archive every review in one place — we'll keep you posted.</p>`,
  };

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      return { ok: false, skipped: false } as const;
    }

    return { ok: true } as const;
  } catch {
    return { ok: false, skipped: false } as const;
  }
}

type EmailSendResult = {
  ok: boolean;
  skipped?: boolean;
  message?: string;
};

export async function sendSubmissionReceiptEmail(
  payload: SubmissionReceiptPayload,
): Promise<EmailSendResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM;

  if (!apiKey || !from) {
    return {
      ok: false,
      skipped: true,
      message: "이메일 발송 설정이 되어 있지 않아 영수증 메일을 보내지 못했습니다.",
    };
  }

  const kindLabel = payload.kind === "MV" ? "뮤직비디오" : "앨범";
  const lines: string[] = [
    `${kindLabel} 접수가 완료되었습니다.`,
    `제목: ${payload.title || "제목 미입력"}`,
  ];
  if (payload.isGuest && payload.guestToken) {
    lines.push(`조회 코드: ${payload.guestToken}`);
    lines.push(`조회 링크: ${payload.link ?? ""}`);
  }

  const html = `
    <div style="font-family: Arial, sans-serif; color: #0f172a;">
      <h2 style="margin:0 0 12px 0;">${kindLabel} 접수 완료</h2>
      ${lines.map((line) => `<p style="margin:4px 0;">${line}</p>`).join("")}
      <p style="margin:12px 0 0 0;">GLIT이 진행 상황을 실시간으로 업데이트합니다.</p>
    </div>
  `;

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: payload.email,
        subject: `[GLIT] ${kindLabel} 접수 완료 안내`,
        html,
      }),
    });

    if (!response.ok) {
      return {
        ok: false,
        skipped: false,
        message: "이메일 발송에 실패했습니다. 잠시 후 다시 시도해주세요.",
      };
    }
    return { ok: true };
  } catch (error) {
    console.error("sendSubmissionReceiptEmail error", error);
    return {
      ok: false,
      skipped: false,
      message: "이메일 발송에 실패했습니다. 잠시 후 다시 시도해주세요.",
    };
  }
}
