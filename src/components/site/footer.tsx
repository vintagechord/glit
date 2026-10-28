"use client";

import Link from "next/link";
import * as React from "react";
import { useModalFocus } from "@/lib/use-modal-focus";
import { usePathname } from "next/navigation";

import { APP_CONFIG } from "@/lib/config";

import {
  termsContent, privacyContent, refundContent, termsContentEn, privacyContentEn, refundContentEn,
  partnershipContent, filePolicyContent, partnershipContentEn, filePolicyContentEn,
} from "@/lib/legal-content";

// Preserve the published imports used by existing signup and policy modals.
export { termsContent, privacyContent, refundContent, termsContentEn, privacyContentEn, refundContentEn } from "@/lib/legal-content";

const footerLinkClass = "transition hover:text-[#f2cf27]";
const footerDisclosureClass =
  "group rounded-[8px] border-2 border-white/14 bg-white/[0.03] px-4 py-3";
const footerSummaryClass =
  "flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-black text-white/86 marker:hidden [&::-webkit-details-marker]:hidden";
const footerPanelClass =
  "mt-3 flex flex-wrap gap-x-4 gap-y-2 border-t border-white/12 pt-3 text-sm font-semibold text-white/68";
const footerLegalButtonClass =
  "text-left transition hover:text-[#f2cf27]";

export function SiteFooter() {
  const pathname = usePathname();
  const isEnglishRoute = pathname === "/en" || pathname.startsWith("/en/");
  const siteLinkPrefix = isEnglishRoute ? "/en" : "";
  const contactPhone = APP_CONFIG.supportPhone;
  const contactEmail = APP_CONFIG.supportEmail;
  const bankName = APP_CONFIG.bankName;
  const bankAccount = APP_CONFIG.bankAccount;
  const bankHolder = APP_CONFIG.bankHolder;

  const [activeModal, setActiveModal] = React.useState<
    "terms" | "privacy" | "refund" | "file" | "partnership" | null
  >(null);

  const closeModal = () => setActiveModal(null);
  const isTermsOpen = activeModal === "terms";
  const isPrivacyOpen = activeModal === "privacy";
  const isRefundOpen = activeModal === "refund";
  const isFileOpen = activeModal === "file";
  const modalTitleKo = isTermsOpen
    ? "이용약관"
    : isPrivacyOpen
      ? "개인정보처리방침"
      : isRefundOpen
        ? "환불/취소 규정"
        : isFileOpen
          ? "파일 보관/삭제 정책"
          : "제휴안내";
  const modalTitleEn = isTermsOpen
    ? "Terms of Use"
    : isPrivacyOpen
      ? "Privacy Policy"
      : isRefundOpen
        ? "Refund / Cancellation Policy"
        : isFileOpen
          ? "File Storage / Deletion Policy"
          : "Partnership";
  const modalTitle = isEnglishRoute ? modalTitleEn : modalTitleKo;
  const modalTag = isTermsOpen
    ? "Terms"
    : isPrivacyOpen
      ? "Privacy"
      : isRefundOpen
        ? "Refund"
        : isFileOpen
          ? "File Policy"
          : "Partnership";
  const modalContentKo = isTermsOpen
    ? termsContent
    : isPrivacyOpen
      ? privacyContent
      : isRefundOpen
        ? refundContent
        : isFileOpen
          ? filePolicyContent
          : partnershipContent;
  const modalContentEn = isTermsOpen
    ? termsContentEn
    : isPrivacyOpen
      ? privacyContentEn
      : isRefundOpen
        ? refundContentEn
        : isFileOpen
          ? filePolicyContentEn
          : partnershipContentEn;
  const modalContent = isEnglishRoute ? modalContentEn : modalContentKo;
  const modalTitleId = React.useId();

  const dialogRef = React.useRef<HTMLDivElement>(null);
  useModalFocus(Boolean(activeModal), dialogRef, closeModal);

  React.useEffect(() => {
    setActiveModal(null);
  }, [pathname]);

  return (
    <footer className="border-t-2 border-[#111111] bg-[#111111] text-[#f7f5ef] dark:border-[#f2cf27] dark:bg-[#0b0b0b]">
      <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        <div className="grid gap-5 border-b-2 border-[#f2cf27] pb-5 md:grid-cols-[1.2fr_0.8fr]">
          <div className="min-w-0 space-y-2.5 [overflow-wrap:anywhere]">
            <Link
              href={`${siteLinkPrefix}/support`}
              target="_blank"
              rel="noopener noreferrer"
              title={isEnglishRoute ? "Opens in a new tab" : "새 창에서 열기"}
              className="inline-flex min-h-11 w-fit items-center bg-[#f2cf27] px-3 py-2 text-xs font-black uppercase tracking-normal text-[#111111] transition hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#f2cf27]"
            >
              {isEnglishRoute ? "Support" : "고객센터"}
            </Link>
            <p className="text-xl font-black text-white sm:text-2xl">
              <a href={`tel:${contactPhone}`} className="underline-offset-2 hover:text-[#f2cf27] hover:underline">
                {contactPhone}
              </a>
            </p>
            <p className="text-base font-medium text-white/86">
              이메일{" "}
              <a href={`mailto:${contactEmail}`} className="underline-offset-2 hover:text-[#f2cf27] hover:underline">
                {contactEmail}
              </a>
            </p>
            <p className="text-base font-medium text-white/72">
              상담시간 {APP_CONFIG.supportHours}
            </p>
          </div>
          <div className="min-w-0 space-y-2.5 [overflow-wrap:anywhere]">
            <p className="w-fit bg-[#1556a4] px-3 py-1 text-xs font-black uppercase tracking-normal text-white">
              입금 계좌
            </p>
            <p className="text-base font-medium text-white/72">
              {bankName} {bankAccount} · 예금주{" "}
              <span className="font-semibold text-white">
                {bankHolder}
              </span>
            </p>
            {APP_CONFIG.bankLink ? (
              <Link
                href={APP_CONFIG.bankLink}
                className="inline-flex items-center rounded-[8px] border-2 border-[#f7f5ef] bg-[#f2cf27] px-4 py-2 text-sm font-black text-[#111111] transition hover:-translate-y-0.5 hover:bg-white"
              >
                인터넷뱅킹 바로가기
              </Link>
            ) : null}
          </div>
        </div>

        <div className="grid gap-3 border-b-2 border-white/12 py-4 md:grid-cols-3">
          <details className={footerDisclosureClass}>
            <summary className={footerSummaryClass}>
              사이트 링크
              <span className="text-xs text-white/46 group-open:hidden">펼치기</span>
              <span className="hidden text-xs text-white/46 group-open:inline">접기</span>
            </summary>
            <div className={footerPanelClass}>
              <Link href={`${siteLinkPrefix}/about`} className={footerLinkClass}>
                회사소개
              </Link>
              <Link href={`${siteLinkPrefix}/guide`} className={footerLinkClass}>
                심의 안내
              </Link>
              <Link href={`${siteLinkPrefix}/faq`} className={footerLinkClass}>
                FAQ
              </Link>
              <Link
                href="https://onside17.com/"
                target="_blank"
                rel="noopener noreferrer"
                className={footerLinkClass}
              >
                Legacy
              </Link>
            </div>
          </details>

          <details className={footerDisclosureClass}>
            <summary className={footerSummaryClass}>
              약관/정책
              <span className="text-xs text-white/46 group-open:hidden">펼치기</span>
              <span className="hidden text-xs text-white/46 group-open:inline">접기</span>
            </summary>
            <div className={footerPanelClass}>
              <button
                type="button"
                onClick={() => setActiveModal("terms")}
                className={footerLegalButtonClass}
              >
                이용약관
              </button>
              <button
                type="button"
                onClick={() => setActiveModal("privacy")}
                className={footerLegalButtonClass}
              >
                개인정보처리방침
              </button>
              <button
                type="button"
                onClick={() => setActiveModal("refund")}
                className={footerLegalButtonClass}
              >
                환불/취소 규정
              </button>
              <button
                type="button"
                onClick={() => setActiveModal("file")}
                className={footerLegalButtonClass}
              >
                파일 보관/삭제 정책
              </button>
              <button
                type="button"
                onClick={() => setActiveModal("partnership")}
                className={footerLegalButtonClass}
              >
                제휴안내
              </button>
            </div>
          </details>

          <details className={footerDisclosureClass}>
            <summary className={footerSummaryClass}>
              사업자 정보
              <span className="text-xs text-white/46 group-open:hidden">펼치기</span>
              <span className="hidden text-xs text-white/46 group-open:inline">접기</span>
            </summary>
            <div className="mt-3 grid gap-1 border-t border-white/12 pt-3 text-sm font-medium text-white/68 sm:grid-cols-2 md:grid-cols-1">
              <p>회사명: {APP_CONFIG.businessName}</p>
              <p>대표자: {APP_CONFIG.businessRep}</p>
              <p className="sm:col-span-2 md:col-span-1">
                주소: {APP_CONFIG.businessAddress}
              </p>
              <p>사업자등록번호: {APP_CONFIG.businessRegNo}</p>
              <p>통신판매업신고번호: {APP_CONFIG.businessMailOrderNo}</p>
              <p>개인정보 보호책임자: {APP_CONFIG.privacyOfficer}</p>
              <p>호스팅 제공자: {APP_CONFIG.hostingProvider}</p>
            </div>
          </details>
        </div>

        <div className="pt-4 text-sm font-medium text-white/58">
          <p className="text-white/52">
            Copyright © {APP_CONFIG.businessName}. All Rights Reserved.
          </p>
        </div>
      </div>

      {activeModal && (
        <div
          className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40 px-4 py-4"
          onClick={closeModal}
        >
          <div
            ref={dialogRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-labelledby={modalTitleId}
            className="flex max-h-[calc(100dvh-2rem)] w-full max-w-3xl flex-col overflow-hidden rounded-[10px] border-2 border-[#111111] bg-[#fffaf0] shadow-[6px_6px_0_#111111]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex shrink-0 items-start justify-between gap-3 border-b-2 border-[#111111] px-4 py-3 sm:px-6 sm:py-4">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <span
                  id={modalTitleId}
                  className="min-w-0 break-keep [overflow-wrap:anywhere] border-2 border-[#111111] bg-[#f2cf27] px-3 py-1 text-xs font-black uppercase tracking-normal text-black"
                >
                  {modalTitle}
                </span>
                <span className="hidden text-xs font-black uppercase tracking-normal text-black/60 sm:inline">
                  {modalTag}
                </span>
              </div>
              <button
                type="button"
                onClick={closeModal}
                className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-[8px] border-2 border-[#111111] px-3 py-2 text-xs font-black uppercase tracking-normal text-black transition hover:bg-[#f2cf27]"
              >
                {isEnglishRoute ? "Close" : "닫기"}
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto whitespace-pre-line [overflow-wrap:anywhere] px-4 py-4 text-xs leading-relaxed text-black/80 sm:px-6 sm:py-5">
              {modalContent}
            </div>
          </div>
        </div>
      )}
    </footer>
  );
}
