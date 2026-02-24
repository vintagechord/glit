type WelcomeEmailPayload = {
  email: string;
  name?: string;
};

type SubmissionReceiptPayload = {
  email: string;
  title: string;
  kind: "ALBUM" | "MV";
  submissionId: string;
  isGuest?: boolean;
  guestToken?: string;
  link?: string;
  siteLink?: string;
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

  const name = payload.name?.trim() || "onside";
  const body = {
    from,
    to: payload.email,
    subject: "Welcome to onside",
    html: `<p>Hi ${name},</p><p>Your release is now officially greenlit with onside.</p><p>Submit, track, and archive every review in one place — we'll keep you posted.</p>`,
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

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const normalizeAbsoluteUrl = (value?: string) => {
  if (!value) return "";
  try {
    return new URL(value).toString();
  } catch {
    return "";
  }
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
        <p style="margin: 8px 0 0 0; color: #cbd5e1; line-height: 1.6;">온사이드 계정의 비밀번호를 새로 설정하려면 아래 버튼을 눌러주세요.</p>
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
        subject: "[onside] 비밀번호 재설정 안내",
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

  const kindLabel = payload.kind === "MV" ? "뮤직비디오" : "음반";
  const safeTitle = escapeHtml(payload.title?.trim() || "제목 미입력");
  const safeSubmissionId = escapeHtml(payload.submissionId);
  const safeGuestToken = escapeHtml(payload.guestToken?.trim() ?? "");
  const siteLink =
    normalizeAbsoluteUrl(payload.siteLink) ||
    normalizeAbsoluteUrl(process.env.NEXT_PUBLIC_SITE_URL) ||
    normalizeAbsoluteUrl(process.env.NEXT_PUBLIC_APP_URL) ||
    "https://onside17.com/";
  const progressLink = normalizeAbsoluteUrl(payload.link) || siteLink;

  const guestCodeSection =
    payload.isGuest && safeGuestToken
      ? `
        <div style="margin: 16px 0 0; border-radius: 12px; border: 1px solid #334155; background: #0b1220; padding: 14px 16px;">
          <p style="margin: 0; font-size: 12px; color: #93c5fd;">비회원 조회 코드</p>
          <p style="margin: 6px 0 0; font-size: 16px; font-weight: 700; letter-spacing: 0.02em; color: #f8fafc;">${safeGuestToken}</p>
        </div>
      `
      : "";

  const html = `
    <div style="margin: 0; padding: 28px 12px; background: #eef2f7; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; color: #0f172a;">
      <div style="max-width: 580px; margin: 0 auto; border-radius: 20px; overflow: hidden; border: 1px solid #d5dbe5; background: #ffffff;">
        <div style="background: linear-gradient(135deg, #0f172a, #1e293b); padding: 24px 24px 20px; color: #f8fafc;">
          <p style="margin: 0; font-size: 12px; letter-spacing: 0.18em; font-weight: 700; text-transform: uppercase; color: #cbd5e1;">Onside Receipt</p>
          <h2 style="margin: 10px 0 0; font-size: 24px; line-height: 1.35; font-weight: 800;">${kindLabel} 접수가 완료되었습니다.</h2>
          <p style="margin: 10px 0 0; font-size: 13px; color: #cbd5e1;">심의 진행, 승인, 기록 아카이브는 온사이드에서 확인할 수 있습니다.</p>
        </div>
        <div style="padding: 22px 24px 24px;">
          <div style="border-radius: 12px; border: 1px solid #e2e8f0; background: #f8fafc; padding: 14px 16px;">
            <p style="margin: 0; font-size: 12px; color: #475569;">접수 유형</p>
            <p style="margin: 6px 0 0; font-size: 15px; font-weight: 700; color: #0f172a;">${kindLabel} 심의</p>
            <p style="margin: 12px 0 0; font-size: 12px; color: #475569;">작품명</p>
            <p style="margin: 6px 0 0; font-size: 15px; font-weight: 700; color: #0f172a;">${safeTitle}</p>
            <p style="margin: 12px 0 0; font-size: 12px; color: #475569;">접수 번호</p>
            <p style="margin: 6px 0 0; font-size: 13px; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace; color: #0f172a;">${safeSubmissionId}</p>
          </div>
          ${guestCodeSection}
          <div style="margin: 18px 0 0; display: flex; flex-wrap: wrap; gap: 10px;">
            <a href="${progressLink}" style="display: inline-block; border-radius: 999px; background: #f6d64a; color: #111827; text-decoration: none; font-size: 13px; font-weight: 800; padding: 11px 18px;">내 심의 진행상황 조회</a>
            <a href="${siteLink}" style="display: inline-block; border-radius: 999px; background: #0f172a; color: #f8fafc; text-decoration: none; font-size: 13px; font-weight: 700; padding: 11px 18px;">온사이드 사이트</a>
          </div>
          <p style="margin: 14px 0 0; font-size: 12px; color: #64748b; line-height: 1.6;">버튼이 동작하지 않으면 아래 링크를 복사해 브라우저에 붙여넣어 주세요.</p>
          <p style="margin: 6px 0 0; font-size: 12px; color: #334155; word-break: break-all;">${escapeHtml(progressLink)}</p>
        </div>
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
        subject: `[onside] ${kindLabel} 접수 완료 안내`,
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
        <div style="font-size: 18px; font-weight: 700; margin: 0 0 6px 0;">온사이드 심의 결과</div>
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
        <p style="margin: 10px 0 0 0; font-size: 12px; color: #94a3b8;">온사이드에 접수한 심의 결과를 안내드립니다.</p>
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
        subject: `[onside] 심의 결과 안내 — ${statusLabel}`,
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
