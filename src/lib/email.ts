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

type ResultEmailPayload = {
  email: string;
  title: string;
  artist?: string | null;
  resultStatus: "APPROVED" | "REJECTED" | "NEEDS_FIX";
  resultMemo?: string | null;
  link?: string;
};

type PasswordResetEmailPayload = {
  email: string;
  link: string;
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

export async function sendPasswordResetEmail(
  payload: PasswordResetEmailPayload,
): Promise<EmailSendResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM;

  if (!apiKey || !from) {
    return {
      ok: false,
      skipped: true,
      message:
        "이메일 발송 설정이 되어 있지 않아 비밀번호 재설정 메일을 보내지 못했습니다.",
    };
  }

  const html = `
    <div style="font-family: Arial, sans-serif; background-color: #0b1120; padding: 32px 0; text-align: center;">
      <div style="max-width: 520px; margin: 0 auto; background: #0f172a; border: 1px solid #1e293b; border-radius: 16px; padding: 28px 24px; color: #e2e8f0;">
        <div style="font-size: 18px; font-weight: 700; margin: 0 0 8px 0;">비밀번호 재설정</div>
        <p style="margin: 8px 0 0 0; color: #cbd5e1; line-height: 1.6;">GLIT 계정의 비밀번호를 새로 설정하려면 아래 버튼을 눌러주세요.</p>
        <a href="${payload.link}" style="display: inline-block; margin: 18px 0 12px; padding: 12px 20px; border-radius: 999px; background: #fcd34d; color: #0f172a; font-weight: 700; text-decoration: none;">비밀번호 재설정하기</a>
        <p style="margin: 10px 0 0 0; font-size: 12px; color: #94a3b8;">버튼이 동작하지 않으면 아래 링크를 복사해 브라우저에 붙여넣어 주세요.</p>
        <p style="margin: 6px 0 0 0; font-size: 12px; color: #cbd5e1; word-break: break-all;">${payload.link}</p>
      </div>
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
        subject: "[GLIT] 비밀번호 재설정 안내",
        html,
      }),
    });

    if (!response.ok) {
      return {
        ok: false,
        skipped: false,
        message: "비밀번호 재설정 메일 발송에 실패했습니다.",
      };
    }

    return { ok: true };
  } catch (error) {
    console.error("sendPasswordResetEmail error", error);
    return {
      ok: false,
      skipped: false,
      message: "비밀번호 재설정 메일 발송에 실패했습니다.",
    };
  }
}

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

export async function sendResultEmail(
  payload: ResultEmailPayload,
): Promise<EmailSendResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM;

  if (!apiKey || !from) {
    return {
      ok: false,
      skipped: true,
      message: "이메일 발송 설정이 되어 있지 않습니다.",
    };
  }

  const statusLabel =
    payload.resultStatus === "APPROVED"
      ? "적격"
      : payload.resultStatus === "NEEDS_FIX"
        ? "수정 요청"
        : "불통과";
  const memo = payload.resultMemo?.trim();

  const html = `
    <div style="font-family: Arial, sans-serif; background-color: #0b1120; padding: 32px 0; text-align: center;">
      <div style="max-width: 520px; margin: 0 auto; background: #0f172a; border: 1px solid #1e293b; border-radius: 16px; padding: 28px 24px; color: #e2e8f0;">
        <div style="font-size: 18px; font-weight: 700; margin: 0 0 6px 0;">GLIT 심의 결과</div>
        <p style="margin: 4px 0 0 0; font-size: 22px; font-weight: 800; color: #fcd34d;">${statusLabel}</p>
        <p style="margin: 12px 0 0 0; color: #cbd5e1; line-height: 1.6;">
          ${payload.title}${payload.artist ? ` · ${payload.artist}` : ""}
        </p>
        ${memo ? `<p style="margin: 12px 0 0 0; color: #e2e8f0; line-height: 1.6; white-space: pre-line;">${memo}</p>` : ""}
        ${
          payload.link
            ? `<a href="${payload.link}" style="display: inline-block; margin: 18px 0 6px; padding: 12px 20px; border-radius: 999px; background: #fcd34d; color: #0f172a; font-weight: 700; text-decoration: none;">결과 상세 보기</a>`
            : ""
        }
        <p style="margin: 10px 0 0 0; font-size: 12px; color: #94a3b8;">GLIT에 접수한 심의 결과를 안내드립니다.</p>
      </div>
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
        subject: `[GLIT] 심의 결과 안내 — ${statusLabel}`,
        html,
      }),
    });

    if (!response.ok) {
      return {
        ok: false,
        skipped: false,
        message: "심의 결과 메일 발송에 실패했습니다.",
      };
    }

    return { ok: true };
  } catch (error) {
    console.error("sendResultEmail error", error);
    return {
      ok: false,
      skipped: false,
      message: "심의 결과 메일 발송에 실패했습니다.",
    };
  }
}
