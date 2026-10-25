import { sendTransactionalEmail, type EmailSendResult } from "@/lib/email-transport";
import { APP_CONFIG } from "@/lib/config";
import type { EmailAttachmentRef } from "@/lib/email-attachments";

type EmailDeliveryOptions = { idempotencyKey?: string; expiresAt?: string };

type WelcomeEmailPayload = EmailDeliveryOptions & {
  email: string;
  name?: string;
};

type SubmissionReceiptPayload = EmailDeliveryOptions & {
  email: string;
  title: string;
  kind: "ALBUM" | "MV";
  submissionId: string;
  isGuest?: boolean;
  guestToken?: string;
  link?: string;
  siteLink?: string;
};

type ResultEmailPayload = EmailDeliveryOptions & {
  email: string;
  title: string;
  artist?: string | null;
  resultStatus: "APPROVED" | "REJECTED" | "NEEDS_FIX";
  resultMemo?: string | null;
  link?: string;
  submissionId?: string;
  markResultNotified?: boolean;
};

type PasswordResetEmailPayload = EmailDeliveryOptions & {
  email: string;
  link: string;
};

type SubmissionBankRequestEmailPayload = EmailDeliveryOptions & {
  email: string;
  title: string;
  artist?: string | null;
  kind: "ALBUM" | "MV";
  amountKrw: number;
  bankDepositorName?: string | null;
  link?: string;
  siteLink?: string;
};

type SubmissionUpdateEmailPayload = EmailDeliveryOptions & {
  email: string;
  title: string;
  artist?: string | null;
  kind: "ALBUM" | "MV";
  headline: string;
  summary: string;
  link?: string;
  subject?: string;
  submissionId?: string;
  guestToken?: string;
  markResultNotified?: boolean;
  attachmentRefs?: EmailAttachmentRef[];
};

type GuestSubmissionLookupEmailPayload = EmailDeliveryOptions & {
  email: string;
  name?: string | null;
  items: Array<{
    token: string;
    title?: string | null;
    type?: string | null;
    createdAt?: string | null;
    link: string;
  }>;
};

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

export async function sendWelcomeEmail(payload: WelcomeEmailPayload): Promise<EmailSendResult> {
  const name = escapeHtml(payload.name?.trim() || "onside");
  const body = {
    html: `<p>${name}님, 온사이드 가입이 완료되었습니다.</p><p>음반·뮤직비디오 심의 신청, 진행 확인, 결과 파일 수령을 한 곳에서 이용하실 수 있습니다.</p><p>다음 신청부터 신청자 정보와 접수 기록을 더 빠르게 관리할 수 있습니다.</p>`,
  };

  return sendTransactionalEmail({ to: payload.email, idempotencyKey: payload.idempotencyKey, expiresAt: payload.expiresAt, subject: "[onside] 회원가입이 완료되었습니다", html: body.html, operation: "welcome" });
}

const normalizeAbsoluteUrl = (value?: string) => {
  if (!value) return "";
  try {
    const parsed = new URL(value);
    if (
      (parsed.protocol !== "https:" && parsed.protocol !== "http:") ||
      parsed.username ||
      parsed.password
    ) {
      return "";
    }
    return parsed.toString();
  } catch {
    return "";
  }
};

export async function sendPasswordResetEmail(
  payload: PasswordResetEmailPayload,
): Promise<EmailSendResult> {
  const normalizedLink = normalizeAbsoluteUrl(payload.link);
  if (!normalizedLink) return { ok: false, reason: "configuration" };
  const safeLink = escapeHtml(normalizedLink);
  const html = `
    <div style="font-family: Arial, sans-serif; background-color: #0b1120; padding: 32px 0; text-align: center;">
      <div style="max-width: 520px; margin: 0 auto; background: #0f172a; border: 1px solid #1e293b; border-radius: 16px; padding: 28px 24px; color: #e2e8f0;">
        <div style="font-size: 18px; font-weight: 700; margin: 0 0 8px 0;">비밀번호 재설정</div>
        <p style="margin: 8px 0 0 0; color: #cbd5e1; line-height: 1.6;">온사이드 계정의 비밀번호를 새로 설정하려면 아래 버튼을 눌러주세요.</p>
        <a href="${safeLink}" style="display: inline-block; margin: 18px 0 12px; padding: 12px 20px; border-radius: 999px; background: #fcd34d; color: #0f172a; font-weight: 700; text-decoration: none;">비밀번호 재설정하기</a>
        <p style="margin: 10px 0 0 0; font-size: 12px; color: #94a3b8;">버튼이 동작하지 않으면 아래 링크를 복사해 브라우저에 붙여넣어 주세요.</p>
        <p style="margin: 6px 0 0 0; font-size: 12px; color: #cbd5e1; word-break: break-all;">${safeLink}</p>
      </div>
    </div>
  `;

  return sendTransactionalEmail({ to: payload.email, idempotencyKey: payload.idempotencyKey, expiresAt: payload.expiresAt, subject: "[onside] 비밀번호 재설정 안내", html, operation: "password reset" });
}

export async function sendSubmissionReceiptEmail(
  payload: SubmissionReceiptPayload,
): Promise<EmailSendResult> {
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
            <a href="${escapeHtml(progressLink)}" style="display: inline-block; border-radius: 999px; background: #f6d64a; color: #111827; text-decoration: none; font-size: 13px; font-weight: 800; padding: 11px 18px;">내 심의 진행상황 조회</a>
            <a href="${escapeHtml(siteLink)}" style="display: inline-block; border-radius: 999px; background: #0f172a; color: #f8fafc; text-decoration: none; font-size: 13px; font-weight: 700; padding: 11px 18px;">온사이드 사이트</a>
          </div>
          <p style="margin: 14px 0 0; font-size: 12px; color: #64748b; line-height: 1.6;">버튼이 동작하지 않으면 아래 링크를 복사해 브라우저에 붙여넣어 주세요.</p>
          <p style="margin: 6px 0 0; font-size: 12px; color: #334155; word-break: break-all;">${escapeHtml(progressLink)}</p>
        </div>
      </div>
    </div>
  `;

  return sendTransactionalEmail({ to: payload.email, idempotencyKey: payload.idempotencyKey, expiresAt: payload.expiresAt, subject: `[onside] ${kindLabel} 접수 완료 안내`, html, operation: "submission receipt" });
}

export async function sendResultEmail(
  payload: ResultEmailPayload,
): Promise<EmailSendResult> {
  const statusLabel =
    payload.resultStatus === "APPROVED"
      ? "적격"
      : payload.resultStatus === "NEEDS_FIX"
        ? "수정 요청"
        : "부적격";
  const memo = payload.resultMemo?.trim();
  const safeTitle = escapeHtml(payload.title?.trim() || "제목 미입력");
  const safeArtist = escapeHtml(payload.artist?.trim() || "");
  const safeMemo = memo ? escapeHtml(memo).replace(/\n/g, "<br />") : "";
  const progressLink = normalizeAbsoluteUrl(payload.link);
  const safeProgressLink = progressLink ? escapeHtml(progressLink) : "";

  const html = `
    <div style="font-family: Arial, sans-serif; background-color: #0b1120; padding: 32px 0; text-align: center;">
      <div style="max-width: 520px; margin: 0 auto; background: #0f172a; border: 1px solid #1e293b; border-radius: 16px; padding: 28px 24px; color: #e2e8f0;">
        <div style="font-size: 18px; font-weight: 700; margin: 0 0 6px 0;">온사이드 심의 결과</div>
        <p style="margin: 4px 0 0 0; font-size: 22px; font-weight: 800; color: #fcd34d;">${statusLabel}</p>
        <p style="margin: 12px 0 0 0; color: #cbd5e1; line-height: 1.6;">
          ${safeTitle}${safeArtist ? ` · ${safeArtist}` : ""}
        </p>
        ${safeMemo ? `<p style="margin: 12px 0 0 0; color: #e2e8f0; line-height: 1.6;">${safeMemo}</p>` : ""}
        ${
          safeProgressLink
            ? `<a href="${safeProgressLink}" style="display: inline-block; margin: 18px 0 6px; padding: 12px 20px; border-radius: 999px; background: #fcd34d; color: #0f172a; font-weight: 700; text-decoration: none;">결과 상세 보기</a>`
            : ""
        }
        <p style="margin: 10px 0 0 0; font-size: 12px; color: #94a3b8;">온사이드에 접수한 심의 결과를 안내드립니다.</p>
      </div>
    </div>
  `;

  return sendTransactionalEmail({ to: payload.email, idempotencyKey: payload.idempotencyKey, expiresAt: payload.expiresAt, subject: `[onside] 심의 결과 안내 — ${statusLabel}`, html, operation: "review result", submissionId: payload.submissionId, markResultNotified: payload.markResultNotified });
}

export async function sendSubmissionBankRequestEmail(
  payload: SubmissionBankRequestEmailPayload,
): Promise<EmailSendResult> {
  const kindLabel = payload.kind === "MV" ? "뮤직비디오" : "음반";
  const safeTitle = escapeHtml(payload.title?.trim() || "제목 미입력");
  const safeArtist = escapeHtml(payload.artist?.trim() || "-");
  const safeDepositor = escapeHtml(payload.bankDepositorName?.trim() || "-");
  const safeAmount = `${new Intl.NumberFormat("ko-KR").format(payload.amountKrw)}원`;
  const safeBankName = escapeHtml(APP_CONFIG.bankName);
  const safeBankAccount = escapeHtml(APP_CONFIG.bankAccount);
  const safeBankHolder = escapeHtml(APP_CONFIG.bankHolder);
  const siteLink =
    normalizeAbsoluteUrl(payload.siteLink) ||
    normalizeAbsoluteUrl(process.env.NEXT_PUBLIC_SITE_URL) ||
    normalizeAbsoluteUrl(process.env.NEXT_PUBLIC_APP_URL) ||
    "https://onside17.com/";
  const progressLink = normalizeAbsoluteUrl(payload.link) || siteLink;

  const html = `
    <div style="margin:0;padding:28px 12px;background:#eef2f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#0f172a;">
      <div style="max-width:580px;margin:0 auto;border-radius:22px;overflow:hidden;border:1px solid #d5dbe5;background:#ffffff;">
        <div style="background:linear-gradient(135deg,#0f172a,#1f2937);padding:24px 24px 20px;color:#f8fafc;">
          <p style="margin:0;font-size:12px;letter-spacing:0.18em;font-weight:700;text-transform:uppercase;color:#cbd5e1;">Onside Bank Transfer</p>
          <h2 style="margin:10px 0 0;font-size:24px;line-height:1.35;font-weight:800;">무통장 입금 안내를 보내드립니다.</h2>
          <p style="margin:10px 0 0;font-size:13px;color:#cbd5e1;">무통장 입금 신청이 저장되었습니다. 입금 및 자료 확인 후 방송국·기관 접수를 진행합니다.</p>
        </div>
        <div style="padding:22px 24px 24px;">
          <div style="display:grid;gap:12px;">
            <div style="border-radius:14px;border:1px solid #d6e8fb;background:#f4f9ff;padding:14px 16px;">
              <p style="margin:0;font-size:12px;color:#475569;">접수 구분</p>
              <p style="margin:6px 0 0;font-size:15px;font-weight:700;color:#0f172a;">${kindLabel} 심의</p>
              <p style="margin:12px 0 0;font-size:12px;color:#475569;">작품명</p>
              <p style="margin:6px 0 0;font-size:15px;font-weight:700;color:#0f172a;">${safeTitle}</p>
              <p style="margin:12px 0 0;font-size:12px;color:#475569;">아티스트</p>
              <p style="margin:6px 0 0;font-size:14px;font-weight:600;color:#0f172a;">${safeArtist}</p>
            </div>
            <div style="border-radius:14px;border:1px solid #dbe3ec;background:#f8fafc;padding:16px;">
              <p style="margin:0;font-size:12px;color:#475569;">입금 금액</p>
              <p style="margin:6px 0 0;font-size:24px;font-weight:800;color:#0071e3;">${safeAmount}</p>
              <div style="margin-top:14px;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;">
                <div>
                  <p style="margin:0;font-size:12px;color:#64748b;">은행명</p>
                  <p style="margin:6px 0 0;font-size:14px;font-weight:700;color:#0f172a;">${safeBankName}</p>
                </div>
                <div>
                  <p style="margin:0;font-size:12px;color:#64748b;">예금주</p>
                  <p style="margin:6px 0 0;font-size:14px;font-weight:700;color:#0f172a;">${safeBankHolder}</p>
                </div>
                <div style="grid-column:1 / -1;">
                  <p style="margin:0;font-size:12px;color:#64748b;">계좌번호</p>
                  <p style="margin:6px 0 0;font-size:16px;font-weight:800;color:#0f172a;letter-spacing:0.01em;">${safeBankAccount}</p>
                </div>
                <div style="grid-column:1 / -1;">
                  <p style="margin:0;font-size:12px;color:#64748b;">입금자명</p>
                  <p style="margin:6px 0 0;font-size:14px;font-weight:700;color:#0f172a;">${safeDepositor}</p>
                </div>
              </div>
            </div>
          </div>
          <div style="margin:18px 0 0;display:flex;flex-wrap:wrap;gap:10px;">
            <a href="${escapeHtml(progressLink)}" style="display:inline-block;border-radius:999px;background:#0071e3;color:#ffffff;text-decoration:none;font-size:13px;font-weight:800;padding:11px 18px;">내 진행상황 보기</a>
            <a href="${escapeHtml(siteLink)}" style="display:inline-block;border-radius:999px;background:#0f172a;color:#f8fafc;text-decoration:none;font-size:13px;font-weight:700;padding:11px 18px;">온사이드 사이트</a>
          </div>
          <p style="margin:14px 0 0;font-size:12px;color:#64748b;line-height:1.6;">입금 후 관리자가 확인하면 진행상황이 자동으로 업데이트됩니다.</p>
          <p style="margin:6px 0 0;font-size:12px;color:#334155;word-break:break-all;">${escapeHtml(progressLink)}</p>
        </div>
      </div>
    </div>
  `;

  return sendTransactionalEmail({ to: payload.email, idempotencyKey: payload.idempotencyKey, expiresAt: payload.expiresAt, subject: `[onside] 무통장 입금 안내 — ${kindLabel} 심의`, html, operation: "bank payment request" });
}

export async function sendSubmissionUpdateEmail(
  payload: SubmissionUpdateEmailPayload,
): Promise<EmailSendResult> {
  const kindLabel = payload.kind === "MV" ? "뮤직비디오" : "음반";
  const safeTitle = escapeHtml(payload.title?.trim() || "제목 미입력");
  const safeArtist = escapeHtml(payload.artist?.trim() || "-");
  const safeHeadline = escapeHtml(payload.headline.trim());
  const safeSummary = escapeHtml(payload.summary.trim()).replace(/\n/g, "<br />");
  const progressLink =
    normalizeAbsoluteUrl(payload.link) ||
    normalizeAbsoluteUrl(process.env.NEXT_PUBLIC_SITE_URL) ||
    normalizeAbsoluteUrl(process.env.NEXT_PUBLIC_APP_URL) ||
    "https://onside17.com/";

  const html = `
    <div style="margin:0;padding:28px 12px;background:#eef2f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#0f172a;">
      <div style="max-width:580px;margin:0 auto;border-radius:22px;overflow:hidden;border:1px solid #d5dbe5;background:#ffffff;">
        <div style="background:linear-gradient(135deg,#0f172a,#1f2937);padding:24px 24px 20px;color:#f8fafc;">
          <p style="margin:0;font-size:12px;letter-spacing:0.18em;font-weight:700;text-transform:uppercase;color:#cbd5e1;">Onside Update</p>
          <h2 style="margin:10px 0 0;font-size:24px;line-height:1.35;font-weight:800;">${safeHeadline}</h2>
          <p style="margin:10px 0 0;font-size:13px;color:#cbd5e1;">관리자 업데이트가 반영되어 진행상황을 다시 확인하실 수 있습니다.</p>
        </div>
        <div style="padding:22px 24px 24px;">
          <div style="border-radius:14px;border:1px solid #dbe3ec;background:#f8fafc;padding:16px;">
            <p style="margin:0;font-size:12px;color:#475569;">접수 구분</p>
            <p style="margin:6px 0 0;font-size:15px;font-weight:700;color:#0f172a;">${kindLabel} 심의</p>
            <p style="margin:12px 0 0;font-size:12px;color:#475569;">작품명</p>
            <p style="margin:6px 0 0;font-size:15px;font-weight:700;color:#0f172a;">${safeTitle}</p>
            <p style="margin:12px 0 0;font-size:12px;color:#475569;">아티스트</p>
            <p style="margin:6px 0 0;font-size:14px;font-weight:600;color:#0f172a;">${safeArtist}</p>
          </div>
          ${payload.submissionId ? `<p style="margin-top:16px;font-size:12px;">접수 번호: ${escapeHtml(payload.submissionId)}</p>` : ""}
          ${payload.guestToken ? `<p style="font-size:13px;word-break:break-all;">비회원 조회 코드: <strong>${escapeHtml(payload.guestToken)}</strong></p>` : ""}
          <div style="margin-top:16px;border-radius:14px;border:1px solid #d6e8fb;background:#f4f9ff;padding:16px;">
            <p style="margin:0;font-size:12px;color:#475569;">업데이트 내용</p>
            <p style="margin:8px 0 0;font-size:14px;line-height:1.7;color:#0f172a;">${safeSummary}</p>
          </div>
          <div style="margin:18px 0 0;display:flex;flex-wrap:wrap;gap:10px;">
            <a href="${escapeHtml(progressLink)}" style="display:inline-block;border-radius:999px;background:#0071e3;color:#ffffff;text-decoration:none;font-size:13px;font-weight:800;padding:11px 18px;">진행상황 바로 보기</a>
          </div>
          <p style="margin:14px 0 0;font-size:12px;color:#64748b;line-height:1.6;">링크를 클릭하면 로그인 후 해당 접수 상세로 이동합니다.</p>
          <p style="margin:6px 0 0;font-size:12px;color:#334155;word-break:break-all;">${escapeHtml(progressLink)}</p>
        </div>
      </div>
    </div>
  `;

  return sendTransactionalEmail({ to: payload.email, idempotencyKey: payload.idempotencyKey, expiresAt: payload.expiresAt, subject: payload.subject ?? `[onside] 심의 업데이트 안내 — ${kindLabel} 심의`, html, operation: "submission update", includeMessageId: true, submissionId: payload.submissionId, markResultNotified: payload.markResultNotified, ...(payload.attachmentRefs ? { attachmentRefs: payload.attachmentRefs } : {}) });
}

export async function sendGuestSubmissionLookupEmail(
  payload: GuestSubmissionLookupEmailPayload,
): Promise<EmailSendResult> {
  const safeName = escapeHtml(payload.name?.trim() || "신청자");
  const itemRows = payload.items
    .slice(0, 10)
    .map((item) => {
      const safeTitle = escapeHtml(item.title?.trim() || "제목 미입력");
      const kindLabel = item.type?.startsWith("MV") ? "뮤직비디오" : "음반";
      const safeToken = escapeHtml(item.token);
      const safeLink = escapeHtml(normalizeAbsoluteUrl(item.link));
      const createdAt = item.createdAt ? new Date(item.createdAt) : null;
      const createdLabel =
        createdAt && !Number.isNaN(createdAt.getTime())
          ? createdAt.toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" })
          : "";
      return `
        <div style="margin-top: 14px; border: 1px solid #d5dbe5; border-radius: 12px; padding: 14px 16px; background: #f8fafc;">
          <p style="margin: 0; font-size: 14px; font-weight: 700; color: #0f172a;">${safeTitle}</p>
          <p style="margin: 5px 0 0; font-size: 12px; color: #64748b;">${kindLabel}${createdLabel ? ` · ${escapeHtml(createdLabel)}` : ""}</p>
          <p style="margin: 10px 0 0; font-size: 12px; color: #475569;">조회 코드</p>
          <p style="margin: 4px 0 0; font-family: monospace; font-size: 13px; overflow-wrap: anywhere; color: #0f172a;">${safeToken}</p>
          <a href="${safeLink}" style="display: inline-block; margin-top: 12px; padding: 10px 14px; border-radius: 8px; background: #f2cf27; color: #111111; font-size: 12px; font-weight: 700; text-decoration: none;">진행상황 확인</a>
        </div>
      `;
    })
    .join("");

  const html = `
    <div style="margin: 0; padding: 28px 12px; background: #eef2f7; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; color: #0f172a;">
      <div style="max-width: 580px; margin: 0 auto; border-radius: 20px; overflow: hidden; border: 1px solid #d5dbe5; background: #ffffff; padding: 24px;">
        <h2 style="margin: 0; font-size: 22px;">비회원 접수 조회 코드</h2>
        <p style="margin: 10px 0 0; color: #475569; line-height: 1.6;">${safeName}님이 요청한 온사이드 접수 조회 정보입니다. 본인이 요청하지 않았다면 이 메일을 무시해주세요.</p>
        ${itemRows}
      </div>
    </div>
  `;

  return sendTransactionalEmail({ to: payload.email, idempotencyKey: payload.idempotencyKey, expiresAt: payload.expiresAt, subject: "[onside] 비회원 접수 조회 코드 안내", html, operation: "guest lookup" });
}

export async function sendSignupVerificationEmail(payload: EmailDeliveryOptions & { email: string; link: string }): Promise<EmailSendResult> {
  const link = normalizeAbsoluteUrl(payload.link);
  if (!link) return { ok: false, reason: "configuration" };
  const safeLink = escapeHtml(link);
  return sendTransactionalEmail({
    to: payload.email, idempotencyKey: payload.idempotencyKey, expiresAt: payload.expiresAt, subject: "[onside] 회원가입 이메일 인증", operation: "signup verification",
    html: `<p>온사이드 가입을 완료하려면 아래 링크를 열어 이메일 인증을 진행해주세요.</p><p><a href="${safeLink}">이메일 인증하기</a></p><p>직접 가입을 요청하지 않았다면 이 메일을 무시해주세요.</p><p>${safeLink}</p>`,
  });
}

export async function sendAccountIdEmail(payload: EmailDeliveryOptions & { email: string; link?: string }): Promise<EmailSendResult> {
  const link = normalizeAbsoluteUrl(payload.link);
  const safeEmail = escapeHtml(payload.email);
  return sendTransactionalEmail({
    to: payload.email, idempotencyKey: payload.idempotencyKey, expiresAt: payload.expiresAt, subject: "[onside] 가입 아이디 안내", operation: "account lookup",
    html: `<p>온사이드의 로그인 아이디는 가입한 이메일 주소입니다.</p><p><strong>${safeEmail}</strong></p>${link ? `<p><a href="${escapeHtml(link)}">로그인하기</a></p>` : ""}<p>직접 아이디 찾기를 요청하지 않았다면 이 메일을 무시해주세요.</p>`,
  });
}
