import { sendTransactionalEmail, type EmailSendResult } from "@/lib/email-transport";
import { APP_CONFIG } from "@/lib/config";
import type { EmailAttachmentRef } from "@/lib/email-attachments";
import { formatDateTime } from "@/lib/format";

type EmailDeliveryOptions = { idempotencyKey?: string; expiresAt?: string };

/** Review receipt notices have one explicitly designated operations mailbox. */
export const REVIEW_ADMIN_EMAIL = "iamonside@daum.net";

type AdminSubmissionReceiptPayload = EmailDeliveryOptions & {
  submissionId: string;
  title: string;
  artist?: string | null;
  submissionType: string;
  amountKrw?: number | null;
  link: string;
};

/** Auth mail follows the UI language the customer used (/en or Korean). */
type LocalizedEmailOptions = { english?: boolean };

type WelcomeEmailPayload = EmailDeliveryOptions & LocalizedEmailOptions & {
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

type PasswordResetEmailPayload = EmailDeliveryOptions & LocalizedEmailOptions & {
  email: string;
  link: string;
};

/** One line of an order as the customer saw it at checkout. */
export type OrderEmailItem = {
  title?: string | null;
  artist?: string | null;
  kind: "ALBUM" | "MV";
  amountKrw?: number | null;
};

type OrderBankTransferEmailPayload = EmailDeliveryOptions & {
  email: string;
  orderId: string;
  items: OrderEmailItem[];
  totalAmountKrw: number;
  depositorName?: string | null;
  depositDueAt?: string | null;
  link?: string;
  siteLink?: string;
};

type PaymentCompletedEmailPayload = EmailDeliveryOptions & {
  email: string;
  orderId: string;
  paymentMethod: "CARD" | "BANK" | "PAYPAL";
  paidAt?: string | null;
  amountLabel: string;
  items: OrderEmailItem[];
  /** At least one application in the order chose to email its files later. */
  awaitingEmailMaterials: boolean;
  link: string;
  ordersLink?: string;
  submissionId?: string;
  guestToken?: string;
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
  const html = payload.english
    ? `<p>Welcome to Onside, ${name}.</p><p>Submit album and music video reviews, follow their progress, and download result files in one place.</p><p>Your applicant details and submission history are kept with your account for faster future applications.</p>`
    : `<p>${name}님, 온사이드 가입이 완료되었습니다.</p><p>음반·뮤직비디오 심의 신청, 진행 확인, 결과 파일 수령을 한 곳에서 이용하실 수 있습니다.</p><p>다음 신청부터 신청자 정보와 접수 기록을 더 빠르게 관리할 수 있습니다.</p>`;

  return sendTransactionalEmail({ to: payload.email, idempotencyKey: payload.idempotencyKey, expiresAt: payload.expiresAt, subject: payload.english ? "[onside] Your Onside account is ready" : "[onside] 회원가입이 완료되었습니다", html, operation: "welcome" });
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

export async function sendAdminSubmissionReceiptEmail(
  payload: AdminSubmissionReceiptPayload,
): Promise<EmailSendResult> {
  const link = normalizeAbsoluteUrl(payload.link);
  if (!link) return { ok: false, reason: "configuration" };
  const kind = payload.submissionType === "MV_BROADCAST" ? "방송용 뮤직비디오"
    : payload.submissionType === "MV_DISTRIBUTION" || payload.submissionType === "MV" ? "온라인 뮤직비디오" : "음반";
  const details = [
    ["접수 구분", `${kind} 심의`],
    ["작품명", payload.title.trim() || "제목 미입력"],
    ["아티스트", payload.artist?.trim() || "-"],
    ["접수 번호", payload.submissionId],
    ["결제 상태", "결제 완료"],
    ["접수 시작 단계", "접수예정"],
    ...(typeof payload.amountKrw === "number" && Number.isFinite(payload.amountKrw)
      ? [["신청 금액", `${payload.amountKrw.toLocaleString("ko-KR")}원`]] : []),
  ];
  const html = `<div style="margin:0;padding:28px 12px;background:#eef2f7;font-family:Arial,sans-serif;color:#0f172a;">
    <div style="max-width:580px;margin:0 auto;border:1px solid #d5dbe5;border-radius:20px;overflow:hidden;background:#fff;">
      <div style="padding:24px;background:#0f172a;color:#f8fafc;"><p style="margin:0;font-size:12px;color:#cbd5e1;">ONSIDE · 관리자 접수 알림</p>
        <h2 style="margin:10px 0 0;font-size:24px;">새 심의 신청이 접수되었습니다.</h2></div>
      <div style="padding:24px;"><p style="margin:0 0 18px;line-height:1.7;">결제가 확인된 신청입니다. 제출 자료를 확인하고 방송사·기관 접수를 진행해주세요.</p>
        <table style="width:100%;border-collapse:collapse;">${details.map(([label, value]) => `<tr><th style="padding:10px;text-align:left;border-bottom:1px solid #e2e8f0;color:#475569;font-size:13px;">${escapeHtml(label)}</th><td style="padding:10px;border-bottom:1px solid #e2e8f0;font-size:14px;word-break:break-word;">${escapeHtml(value)}</td></tr>`).join("")}</table>
        <a href="${escapeHtml(link)}" style="display:inline-block;margin-top:22px;padding:12px 18px;border-radius:999px;background:#0071e3;color:#fff;text-decoration:none;font-weight:700;">관리자 페이지에서 접수 확인</a>
        <p style="margin-top:16px;font-size:12px;color:#64748b;line-height:1.6;">관리자 로그인이 필요합니다. 현재 진행상황과 자료는 연결된 관리자 페이지에서 확인할 수 있습니다.</p>
        <p style="font-size:12px;color:#334155;word-break:break-all;">${escapeHtml(link)}</p>
      </div></div></div>`;
  return sendTransactionalEmail({
    to: REVIEW_ADMIN_EMAIL,
    subject: `[onside 관리자] ${kind} 심의 접수 알림`,
    html, operation: "admin submission receipt", submissionId: payload.submissionId,
    idempotencyKey: payload.idempotencyKey ?? `admin-submission-received:${payload.submissionId}`,
    expiresAt: payload.expiresAt,
  });
}

export async function sendPasswordResetEmail(
  payload: PasswordResetEmailPayload,
): Promise<EmailSendResult> {
  const normalizedLink = normalizeAbsoluteUrl(payload.link);
  if (!normalizedLink) return { ok: false, reason: "configuration" };
  const safeLink = escapeHtml(normalizedLink);
  const copy = payload.english
    ? { title: "Reset your password", intro: "Press the button below to choose a new password for your Onside account.", button: "Reset password", fallback: "If the button does not work, copy the link below into your browser.", subject: "[onside] Password reset" }
    : { title: "비밀번호 재설정", intro: "온사이드 계정의 비밀번호를 새로 설정하려면 아래 버튼을 눌러주세요.", button: "비밀번호 재설정하기", fallback: "버튼이 동작하지 않으면 아래 링크를 복사해 브라우저에 붙여넣어 주세요.", subject: "[onside] 비밀번호 재설정 안내" };
  const html = `
    <div style="font-family: Arial, sans-serif; background-color: #0b1120; padding: 32px 0; text-align: center;">
      <div style="max-width: 520px; margin: 0 auto; background: #0f172a; border: 1px solid #1e293b; border-radius: 16px; padding: 28px 24px; color: #e2e8f0;">
        <div style="font-size: 18px; font-weight: 700; margin: 0 0 8px 0;">${copy.title}</div>
        <p style="margin: 8px 0 0 0; color: #cbd5e1; line-height: 1.6;">${copy.intro}</p>
        <a href="${safeLink}" style="display: inline-block; margin: 18px 0 12px; padding: 12px 20px; border-radius: 999px; background: #fcd34d; color: #0f172a; font-weight: 700; text-decoration: none;">${copy.button}</a>
        <p style="margin: 10px 0 0 0; font-size: 12px; color: #94a3b8;">${copy.fallback}</p>
        <p style="margin: 6px 0 0 0; font-size: 12px; color: #cbd5e1; word-break: break-all;">${safeLink}</p>
      </div>
    </div>
  `;

  return sendTransactionalEmail({ to: payload.email, idempotencyKey: payload.idempotencyKey, expiresAt: payload.expiresAt, subject: copy.subject, html, operation: "password reset" });
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

const formatKrw = (value: number) => `${new Intl.NumberFormat("ko-KR").format(Math.round(value))}원`;
const orderKindLabel = (kind: OrderEmailItem["kind"]) => (kind === "MV" ? "뮤직비디오" : "음반");
const paymentMethodLabel = (method: PaymentCompletedEmailPayload["paymentMethod"]) =>
  method === "BANK" ? "무통장 입금" : method === "PAYPAL" ? "PayPal" : "카드 결제";
const resolveSiteLink = (value?: string) =>
  normalizeAbsoluteUrl(value) ||
  normalizeAbsoluteUrl(process.env.NEXT_PUBLIC_SITE_URL) ||
  normalizeAbsoluteUrl(process.env.NEXT_PUBLIC_APP_URL) ||
  "https://onside17.com/";

const renderOrderItems = (items: OrderEmailItem[]) => {
  const cell = "padding:10px 8px;border-bottom:1px solid #e2e8f0;font-size:13px;vertical-align:top;";
  const rows = items.map((item) => {
    const amount = typeof item.amountKrw === "number" && Number.isFinite(item.amountKrw) ? formatKrw(item.amountKrw) : "-";
    return `<tr>
      <td style="${cell}color:#475569;white-space:nowrap;">${orderKindLabel(item.kind)} 심의</td>
      <td style="${cell}word-break:break-word;"><strong>${escapeHtml(item.title?.trim() || "제목 미입력")}</strong><br /><span style="color:#64748b;">${escapeHtml(item.artist?.trim() || "-")}</span></td>
      <td style="${cell}text-align:right;white-space:nowrap;font-weight:700;">${amount}</td>
    </tr>`;
  }).join("");
  const head = "padding:8px;border-bottom:2px solid #cbd5e1;font-size:12px;color:#475569;text-align:left;";
  return `<table style="width:100%;border-collapse:collapse;">
    <thead><tr><th style="${head}">구분</th><th style="${head}">작품명 · 아티스트</th><th style="${head}text-align:right;">금액</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
};

/** Bank account and order summary, one message per order and recipient. */
export async function sendOrderBankTransferEmail(
  payload: OrderBankTransferEmailPayload,
): Promise<EmailSendResult> {
  const siteLink = resolveSiteLink(payload.siteLink);
  const progressLink = normalizeAbsoluteUrl(payload.link) || siteLink;
  const safeOrderId = escapeHtml(payload.orderId);
  const safeSupport = escapeHtml(APP_CONFIG.supportEmail);
  const depositDueLabel = (() => {
    if (!payload.depositDueAt) return null;
    const due = new Date(payload.depositDueAt);
    if (!Number.isFinite(due.valueOf())) return null;
    return `${new Date(due.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)}까지`;
  })();

  const html = `
    <div style="margin:0;padding:28px 12px;background:#eef2f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#0f172a;">
      <div style="max-width:580px;margin:0 auto;border-radius:22px;overflow:hidden;border:1px solid #d5dbe5;background:#ffffff;">
        <div style="background:linear-gradient(135deg,#0f172a,#1f2937);padding:24px 24px 20px;color:#f8fafc;">
          <p style="margin:0;font-size:12px;letter-spacing:0.18em;font-weight:700;text-transform:uppercase;color:#cbd5e1;">Onside Bank Transfer</p>
          <h2 style="margin:10px 0 0;font-size:24px;line-height:1.35;font-weight:800;">무통장 입금 안내</h2>
          <p style="margin:10px 0 0;font-size:13px;color:#cbd5e1;">입금 신청이 접수되었습니다. 아래 계좌로 입금해주시면 입금 확인 후 심의 접수를 진행합니다.</p>
        </div>
        <div style="padding:22px 24px 24px;">
          <div style="border-radius:14px;border:1px solid #dbe3ec;background:#f8fafc;padding:16px;">
            <p style="margin:0;font-size:12px;color:#475569;">입금 금액</p>
            <p style="margin:6px 0 0;font-size:24px;font-weight:800;color:#0071e3;">${formatKrw(payload.totalAmountKrw)}</p>
            <div style="margin-top:14px;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;">
              <div>
                <p style="margin:0;font-size:12px;color:#64748b;">은행명</p>
                <p style="margin:6px 0 0;font-size:14px;font-weight:700;color:#0f172a;">${escapeHtml(APP_CONFIG.bankName)}</p>
              </div>
              <div>
                <p style="margin:0;font-size:12px;color:#64748b;">예금주</p>
                <p style="margin:6px 0 0;font-size:14px;font-weight:700;color:#0f172a;">${escapeHtml(APP_CONFIG.bankHolder)}</p>
              </div>
              <div style="grid-column:1 / -1;">
                <p style="margin:0;font-size:12px;color:#64748b;">계좌번호</p>
                <p style="margin:6px 0 0;font-size:16px;font-weight:800;color:#0f172a;letter-spacing:0.01em;">${escapeHtml(APP_CONFIG.bankAccount)}</p>
              </div>
              ${payload.depositorName ? `<div>
                <p style="margin:0;font-size:12px;color:#64748b;">입금자명</p>
                <p style="margin:6px 0 0;font-size:14px;font-weight:700;color:#0f172a;">${escapeHtml(payload.depositorName)}</p>
              </div>` : ""}
              ${depositDueLabel ? `<div>
                <p style="margin:0;font-size:12px;color:#64748b;">입금 예정일</p>
                <p style="margin:6px 0 0;font-size:14px;font-weight:700;color:#0f172a;">${escapeHtml(depositDueLabel)}</p>
              </div>` : ""}
            </div>
          </div>
          <div style="margin-top:16px;border-radius:14px;border:1px solid #d6e8fb;background:#f4f9ff;padding:16px;">
            <p style="margin:0;font-size:12px;color:#475569;">주문 내역</p>
            <p style="margin:6px 0 12px;font-size:12px;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,'Liberation Mono',monospace;color:#0f172a;word-break:break-all;">주문번호 ${safeOrderId}</p>
            ${renderOrderItems(payload.items)}
            <p style="margin:12px 0 0;text-align:right;font-size:14px;font-weight:800;color:#0f172a;">합계 ${formatKrw(payload.totalAmountKrw)}</p>
          </div>
          <div style="margin:18px 0 0;display:flex;flex-wrap:wrap;gap:10px;">
            <a href="${escapeHtml(progressLink)}" style="display:inline-block;border-radius:999px;background:#0071e3;color:#ffffff;text-decoration:none;font-size:13px;font-weight:800;padding:11px 18px;">주문내역 보기</a>
            <a href="${escapeHtml(siteLink)}" style="display:inline-block;border-radius:999px;background:#0f172a;color:#f8fafc;text-decoration:none;font-size:13px;font-weight:700;padding:11px 18px;">온사이드 사이트</a>
          </div>
          <p style="margin:14px 0 0;font-size:12px;color:#64748b;line-height:1.6;">입금이 확인되면 결제 완료 안내 메일을 보내드리고 진행상황이 자동으로 업데이트됩니다. 입금자명이 신청자명과 다르면 ${safeSupport}로 알려주세요. 아직 입금하지 않았다면 주문내역에서 결제 수단을 다시 선택할 수 있습니다.</p>
          <p style="margin:6px 0 0;font-size:12px;color:#334155;word-break:break-all;">${escapeHtml(progressLink)}</p>
        </div>
      </div>
    </div>
  `;

  return sendTransactionalEmail({ to: payload.email, idempotencyKey: payload.idempotencyKey, expiresAt: payload.expiresAt, subject: "[onside] 무통장 입금 계좌 및 주문 내역 안내", html, operation: "bank payment request" });
}

/** Payment confirmation with the order summary; one message per order and recipient. */
export async function sendPaymentCompletedEmail(
  payload: PaymentCompletedEmailPayload,
): Promise<EmailSendResult> {
  const progressLink = normalizeAbsoluteUrl(payload.link) || resolveSiteLink();
  const ordersLink = normalizeAbsoluteUrl(payload.ordersLink);
  const isBank = payload.paymentMethod === "BANK";
  const safeSupport = escapeHtml(APP_CONFIG.supportEmail);
  const details = [
    ["주문번호", payload.orderId],
    ["결제 수단", paymentMethodLabel(payload.paymentMethod)],
    ["결제 금액", payload.amountLabel],
    [isBank ? "입금 확인 일시" : "결제 일시", formatDateTime(payload.paidAt)],
  ];

  const html = `
    <div style="margin:0;padding:28px 12px;background:#eef2f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#0f172a;">
      <div style="max-width:580px;margin:0 auto;border-radius:22px;overflow:hidden;border:1px solid #d5dbe5;background:#ffffff;">
        <div style="background:linear-gradient(135deg,#0f172a,#1f2937);padding:24px 24px 20px;color:#f8fafc;">
          <p style="margin:0;font-size:12px;letter-spacing:0.18em;font-weight:700;text-transform:uppercase;color:#cbd5e1;">Onside Payment</p>
          <h2 style="margin:10px 0 0;font-size:24px;line-height:1.35;font-weight:800;">${isBank ? "입금이 확인되었습니다." : "결제가 완료되었습니다."}</h2>
          <p style="margin:10px 0 0;font-size:13px;color:#cbd5e1;">심의 신청이 접수예정 단계로 등록되었습니다. 자료 확인 후 방송사·기관 접수를 진행합니다.</p>
        </div>
        <div style="padding:22px 24px 24px;">
          <table style="width:100%;border-collapse:collapse;">${details.map(([label, value]) => `<tr><th style="padding:10px 8px;text-align:left;border-bottom:1px solid #e2e8f0;color:#475569;font-size:13px;white-space:nowrap;">${escapeHtml(label)}</th><td style="padding:10px 8px;border-bottom:1px solid #e2e8f0;font-size:14px;font-weight:700;word-break:break-all;">${escapeHtml(value)}</td></tr>`).join("")}</table>
          <div style="margin-top:16px;border-radius:14px;border:1px solid #d6e8fb;background:#f4f9ff;padding:16px;">
            <p style="margin:0 0 12px;font-size:12px;color:#475569;">주문 내역</p>
            ${renderOrderItems(payload.items)}
            <p style="margin:12px 0 0;text-align:right;font-size:14px;font-weight:800;color:#0f172a;">합계 ${escapeHtml(payload.amountLabel)}</p>
          </div>
          ${payload.submissionId ? `<p style="margin-top:16px;font-size:12px;color:#334155;">접수 번호: ${escapeHtml(payload.submissionId)}</p>` : ""}
          ${payload.guestToken ? `<p style="margin:6px 0 0;font-size:13px;word-break:break-all;">비회원 조회 코드: <strong>${escapeHtml(payload.guestToken)}</strong></p>` : ""}
          ${payload.awaitingEmailMaterials ? `<div style="margin-top:16px;border-radius:14px;border:1px solid #fde68a;background:#fffbeb;padding:16px;">
            <p style="margin:0;font-size:13px;font-weight:800;color:#92400e;">이메일 파일 제출 안내</p>
            <p style="margin:8px 0 0;font-size:13px;line-height:1.7;color:#78350f;">파일을 이메일로 제출하기로 선택한 신청이 있습니다. 메일 제목에 접수 번호를 포함해 ${safeSupport}로 파일을 보내주세요. 자료를 확인한 후 접수를 진행합니다.</p>
          </div>` : ""}
          <div style="margin:18px 0 0;display:flex;flex-wrap:wrap;gap:10px;">
            <a href="${escapeHtml(progressLink)}" style="display:inline-block;border-radius:999px;background:#0071e3;color:#ffffff;text-decoration:none;font-size:13px;font-weight:800;padding:11px 18px;">진행상황 바로 보기</a>
            ${ordersLink ? `<a href="${escapeHtml(ordersLink)}" style="display:inline-block;border-radius:999px;background:#0f172a;color:#f8fafc;text-decoration:none;font-size:13px;font-weight:700;padding:11px 18px;">주문내역 보기</a>` : ""}
          </div>
          <p style="margin:14px 0 0;font-size:12px;color:#64748b;line-height:1.6;">${payload.guestToken ? "링크를 열면 조회 코드로 접수 상세를 확인할 수 있습니다." : "링크를 클릭하면 로그인 후 해당 접수 상세로 이동합니다."}</p>
          <p style="margin:6px 0 0;font-size:12px;color:#334155;word-break:break-all;">${escapeHtml(progressLink)}</p>
        </div>
      </div>
    </div>
  `;

  return sendTransactionalEmail({ to: payload.email, idempotencyKey: payload.idempotencyKey, expiresAt: payload.expiresAt, subject: isBank ? "[onside] 입금 확인 및 심의 접수 안내" : "[onside] 결제 완료 및 심의 접수 안내", html, operation: "payment completed", includeMessageId: true, submissionId: payload.submissionId });
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
          <p style="margin:14px 0 0;font-size:12px;color:#64748b;line-height:1.6;">${payload.guestToken ? "링크를 열면 조회 코드로 접수 상세를 확인할 수 있습니다." : "링크를 클릭하면 로그인 후 해당 접수 상세로 이동합니다."}</p>
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

export async function sendSignupVerificationEmail(payload: EmailDeliveryOptions & LocalizedEmailOptions & { email: string; link: string }): Promise<EmailSendResult> {
  const link = normalizeAbsoluteUrl(payload.link);
  if (!link) return { ok: false, reason: "configuration" };
  const safeLink = escapeHtml(link);
  return sendTransactionalEmail({
    to: payload.email, idempotencyKey: payload.idempotencyKey, expiresAt: payload.expiresAt,
    subject: payload.english ? "[onside] Verify your email address" : "[onside] 회원가입 이메일 인증", operation: "signup verification",
    html: payload.english
      ? `<p>Open the link below to verify your email address and finish creating your Onside account.</p><p><a href="${safeLink}">Verify email</a></p><p>If you did not sign up, you can ignore this message.</p><p>${safeLink}</p>`
      : `<p>온사이드 가입을 완료하려면 아래 링크를 열어 이메일 인증을 진행해주세요.</p><p><a href="${safeLink}">이메일 인증하기</a></p><p>직접 가입을 요청하지 않았다면 이 메일을 무시해주세요.</p><p>${safeLink}</p>`,
  });
}

export type ReviewSummaryEmailRow = {
  name: string;
  status: string;
  tone: "waiting" | "progress" | "approved" | "attention" | "rejected";
  detail?: string | null;
};
export type ReviewSummaryEmailContent = {
  title: string;
  artist?: string | null;
  kind: "ALBUM" | "MV_BROADCAST" | "MV_DISTRIBUTION";
  updatedAt: string;
  link: string;
  rows: ReviewSummaryEmailRow[];
  completedCount: number;
  attachmentCount: 0 | 3;
};

/** One renderer for the administrator preview and the actual queued message.
 * Only structured values enter the template; caller HTML is never interpolated.
 */
export function renderReviewSummaryEmail(content: ReviewSummaryEmailContent) {
  const link = normalizeAbsoluteUrl(content.link);
  if (!link) throw new Error("A valid review-status link is required");
  const kind = content.kind === "ALBUM" ? "음반 심의" : content.kind === "MV_BROADCAST" ? "방송용 뮤직비디오 심의" : "온라인 뮤직비디오 심의";
  const title = content.title?.trim() || "제목 미입력";
  const subject = `[onside] 심의 현황 안내 — ${title.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, " ").slice(0, 160)}`;
  const updated = new Date(content.updatedAt);
  const dateLabel = Number.isNaN(updated.getTime()) ? "최신 저장 내용 기준" : new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(updated);
  const colors: Record<ReviewSummaryEmailRow["tone"], { background: string; color: string }> = {
    waiting: { background: "#ebe7de", color: "#5c5951" },
    progress: { background: "#e6edf7", color: "#1556a4" },
    approved: { background: "#dceee5", color: "#1f7a5a" },
    attention: { background: "#fff0d3", color: "#8c580a" },
    rejected: { background: "#fae2df", color: "#a72820" },
  };
  const rows = content.rows.map((row, index) => {
    const color = colors[row.tone] ?? colors.waiting;
    return `<tr>
      <td style="padding:17px 18px;border-top:${index ? "1px solid #ded9cd" : "0"};vertical-align:top;font-size:15px;font-weight:700;color:#111111;">
        ${escapeHtml(row.name)}${row.detail ? `<div style="margin-top:6px;font-size:12px;font-weight:400;line-height:1.6;color:#625e54;">${escapeHtml(row.detail)}</div>` : ""}
      </td>
      <td style="padding:17px 18px;border-top:${index ? "1px solid #ded9cd" : "0"};vertical-align:top;text-align:right;white-space:nowrap;">
        <span style="display:inline-block;padding:5px 10px;border-radius:4px;background:${color.background};color:${color.color};font-size:12px;font-weight:700;line-height:1.5;">${escapeHtml(row.status)}</span>
      </td>
    </tr>`;
  }).join("");
  const online = content.kind === "MV_DISTRIBUTION";
  const summary = online
    ? "영상물등급위원회 심의 결과를 확인해주세요."
    : "신청하신 방송사별 심의 현황을 한 번에 정리했습니다. 진행 중인 항목도 함께 확인하실 수 있습니다.";
  const attachments = content.attachmentCount === 3 ? `<tr><td style="padding:0 28px 24px;">
    <table role="presentation" style="width:100%;border-collapse:collapse;border:1px solid #c6dacd;background:#eef6f0;"><tr><td style="padding:17px 18px;">
      <p style="margin:0 0 9px;font-size:13px;font-weight:700;color:#1f7a5a;">함께 보내드리는 파일 · 3개</p>
      <p style="margin:0;font-size:13px;line-height:1.9;color:#283c30;">등급 이미지<br>등급 표시 사용 예시 PDF<br>영등위 발급 심의필증</p>
      <p style="margin:10px 0 0;font-size:12px;line-height:1.6;color:#536358;">세 파일은 메일에 첨부되어 있으며, 아래 결과 페이지에서도 다운로드하실 수 있습니다.</p>
    </td></tr></table>
  </td></tr>` : "";
  const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#f7f5ef;color:#111111;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Apple SD Gothic Neo','Malgun Gothic',Arial,sans-serif;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(title)} · ${escapeHtml(kind)} 현황을 확인해주세요.</div>
<table role="presentation" style="width:100%;border-collapse:collapse;background:#f7f5ef;"><tr><td style="padding:30px 12px;">
<table role="presentation" align="center" style="width:100%;max-width:620px;margin:0 auto;border-collapse:collapse;background:#fffdf8;border:2px solid #111111;">
  <tr><td style="padding:20px 28px;border-bottom:2px solid #111111;background:#f2cf27;">
    <table role="presentation" style="width:100%;border-collapse:collapse;"><tr><td style="font-size:26px;font-weight:900;letter-spacing:-1px;color:#111111;">onside<span style="color:#1f7a5a;">.</span></td><td style="text-align:right;font-size:10px;font-weight:700;letter-spacing:1.5px;color:#353126;">REVIEW STATUS</td></tr></table>
  </td></tr>
  <tr><td style="padding:30px 28px 22px;">
    <p style="margin:0 0 10px;font-size:11px;font-weight:700;letter-spacing:1.2px;color:#1f7a5a;">${escapeHtml(kind)}</p>
    <h1 style="margin:0;font-size:28px;line-height:1.4;letter-spacing:-1px;font-weight:800;">심의 현황을 안내드립니다.</h1>
    <p style="margin:12px 0 0;font-size:14px;line-height:1.8;color:#625e54;">${summary}</p>
  </td></tr>
  <tr><td style="padding:0 28px 25px;">
    <table role="presentation" style="width:100%;border-collapse:collapse;background:#f7f5ef;border-left:4px solid #111111;"><tr><td style="padding:17px 18px;">
      <p style="margin:0;font-size:20px;line-height:1.5;font-weight:800;color:#111111;">${escapeHtml(title)}</p>
      <p style="margin:5px 0 0;font-size:13px;line-height:1.6;color:#625e54;">${escapeHtml(content.artist?.trim() || "아티스트 미입력")}</p>
    </td></tr></table>
  </td></tr>
  <tr><td style="padding:0 28px 12px;">
    <table role="presentation" style="width:100%;border-collapse:collapse;"><tr><td style="font-size:15px;font-weight:800;">${online ? "영등위 심의 결과" : "방송사별 심의 현황"}</td><td style="text-align:right;font-size:12px;color:#625e54;">${Math.max(0, Math.min(content.rows.length, content.completedCount))} / ${content.rows.length} 완료</td></tr></table>
  </td></tr>
  <tr><td style="padding:0 28px 12px;"><table role="presentation" style="width:100%;border-collapse:collapse;border:1px solid #ded9cd;">${rows || '<tr><td style="padding:18px;font-size:13px;color:#625e54;">등록된 심의 항목이 없습니다.</td></tr>'}</table></td></tr>
  <tr><td style="padding:0 28px 25px;"><p style="margin:0;font-size:11px;line-height:1.7;color:#777166;">기준: ${escapeHtml(dateLabel)} (한국 시간)<br>이메일은 발송 시 저장된 현황입니다. 이후 변경사항과 자세한 곡별 결과는 아래 페이지에서 확인해주세요.</p></td></tr>
  ${attachments}
  <tr><td style="padding:0 28px 28px;text-align:center;">
    <a href="${escapeHtml(link)}" style="display:block;padding:15px 18px;border:2px solid #111111;background:#f2cf27;color:#111111;text-decoration:none;font-size:14px;line-height:1.5;font-weight:800;text-align:center;">전체 심의 현황 확인&nbsp; →</a>
    <p style="margin:12px 0 0;font-size:11px;line-height:1.7;color:#777166;">기존 온사이드 결과 페이지로 연결됩니다.<br>회원은 로그인 후, 비회원은 전용 조회 링크로 확인하실 수 있습니다.</p>
  </td></tr>
  <tr><td style="padding:20px 28px;border-top:1px solid #ded9cd;background:#f7f5ef;"><p style="margin:0;font-size:11px;line-height:1.8;color:#777166;">온사이드 · 음반과 뮤직비디오의 심의 진행을 함께합니다.<br>버튼이 열리지 않으면 아래 주소를 브라우저에서 열어주세요.</p><p style="margin:7px 0 0;font-size:10px;line-height:1.6;word-break:break-all;color:#625e54;">${escapeHtml(link)}</p></td></tr>
</table></td></tr></table></body></html>`;
  return { subject, html };
}

export async function sendReviewSummaryEmail(payload: EmailDeliveryOptions & {
  email: string;
  submissionId: string;
  content: ReviewSummaryEmailContent;
  markResultNotified?: boolean;
  attachmentRefs?: EmailAttachmentRef[];
}): Promise<EmailSendResult> {
  const rendered = renderReviewSummaryEmail(payload.content);
  return sendTransactionalEmail({
    to: payload.email, ...rendered, operation: "review result", includeMessageId: true,
    submissionId: payload.submissionId, idempotencyKey: payload.idempotencyKey,
    expiresAt: payload.expiresAt, markResultNotified: payload.markResultNotified,
    ...(payload.attachmentRefs ? { attachmentRefs: payload.attachmentRefs } : {}),
  });
}
