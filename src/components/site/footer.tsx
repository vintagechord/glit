"use client";

import Link from "next/link";
import * as React from "react";
import { usePathname } from "next/navigation";

import { APP_CONFIG } from "@/lib/config";

export const termsContent = `온사이드 심의 서비스 이용약관

제1조 목적
이 약관은 온사이드 심의센터가 제공하는 음반·뮤직비디오 심의 신청, 파일 제출, 결제, 진행 확인, 결과 수령 서비스 이용 조건과 회사와 이용자의 권리·의무를 정합니다.

제2조 서비스 범위
회사는 온라인 신청서 접수, 자료 검수, 음원·영상 파일 관리, 방송국/기관 접수 대행, 진행 상태 안내, 결과 파일 또는 필증 안내, 결제 및 증빙 발급 지원을 제공합니다.

제3조 이용자 의무
이용자는 실제 발매 또는 송출 목적과 일치하는 음원, 영상, 가사, 앨범 정보, 신청자 정보를 제출해야 합니다. 허위 정보, 누락 자료, 권리 침해 자료 제출로 발생하는 지연 또는 책임은 이용자에게 있습니다.

제4조 파일 제출과 보관
업로드 또는 이메일로 제출된 파일은 심의 진행 목적에 한해 사용합니다. 파일 보관 및 삭제 기준은 별도 파일 보관/삭제 정책을 따릅니다.

제5조 결제와 취소
이용자는 결제 전 선택한 심의 종류, 방송국/기관, 총 금액, 증빙 요청 정보를 확인해야 합니다. 환불과 취소는 별도 환불/취소 규정을 따릅니다.

제6조 심의 결과
방송국/기관의 심의 결과와 처리 기간은 각 기관 기준에 따릅니다. 회사는 접수 및 진행 현황을 확인해 안내하지만, 특정 결과 통과를 보장하지 않습니다.

제7조 비회원 조회
비회원 접수자는 발급된 조회 코드로 진행 상태와 결과를 확인합니다. 조회 코드를 분실한 경우 신청자명과 이메일 등 본인 확인 정보를 통해 재확인을 요청할 수 있습니다.

제8조 약관 변경
회사는 서비스 운영과 관련 법령 변경에 따라 약관을 변경할 수 있으며, 중요한 변경 사항은 사이트에 공지합니다.`;

export const privacyContent = `온사이드 개인정보처리방침

온사이드는 음반·뮤직비디오 심의 신청, 파일 제출, 결제, 진행 확인, 결과 수령 서비스를 제공하기 위해 필요한 범위에서 개인정보를 수집·이용합니다.

1. 수집 항목
회원가입: 이메일, 비밀번호
심의 신청: 신청자명, 연락처, 이메일, 회사/기획사명, 아티스트명, 앨범·곡·영상 정보, 결제 및 증빙 발급 정보
파일 제출: 음원, 영상, 가사, 신청서, 사업자등록증 등 이용자가 제출한 자료
서비스 이용 과정: 접속 기록, 조회 코드, 결제 상태, 진행 상태, 문의 내역

2. 이용 목적
심의 신청 접수와 본인 확인, 자료 검수, 방송국/기관 접수 대행, 진행 상태 안내, 결과 및 필증 제공, 결제 처리, 세금계산서·현금영수증 등 증빙 발급, 고객 문의 대응, 부정 이용 방지에 사용합니다.

3. 보관 기간
회원 정보는 회원 탈퇴 또는 서비스 이용 목적 달성 시까지 보관합니다. 심의 신청, 결제, 세금 증빙, 분쟁 대응에 필요한 기록은 관련 법령에서 정한 기간 동안 보관할 수 있습니다. 업로드 파일의 보관과 삭제는 파일 보관/삭제 정책을 따릅니다.

4. 제3자 제공과 처리 위탁
심의 접수를 위해 필요한 자료는 방송국·심의기관·결제대행사·스토리지·알림 발송 서비스 등 업무 수행에 필요한 범위에서 제공 또는 위탁될 수 있습니다. 회사는 목적 외 제공을 하지 않으며, 위탁사가 개인정보를 안전하게 처리하도록 관리합니다.

5. 이용자 권리
이용자는 본인 개인정보의 열람, 정정, 삭제, 처리 정지를 요청할 수 있습니다. 법령상 보관 의무가 있는 정보는 해당 기간 동안 삭제가 제한될 수 있습니다.

6. 안전성 확보
회사는 접근 권한 관리, 암호화 통신, 파일 접근 제한, 업무 담당자 접근 통제 등 개인정보와 저작물 자료 보호를 위한 기술적·관리적 조치를 적용합니다.

7. 개인정보 보호책임자
개인정보 보호책임자: ${APP_CONFIG.privacyOfficer}
문의: ${APP_CONFIG.supportEmail}`;

const partnershipContent = `제휴안내
독창적인 아이디어나 사업모델을 가지고 계신 분은 언제든지 제안을 주세요.

제안 절차
1. 제휴 및 제안 접수 : 메일로 제안(연락처와 성함 필수)
2. 담당자 검토 : 2~3일 정도 소요 됩니다.
3. 연락 : 좋은 제안에 대해 연락을 드립니다.
4. 채택 및 실행 : 채택이 되면 계약을 체결하고 실행을 합니다.

접수 방법
아래의 이메일로 제휴 문의 바랍니다.
${APP_CONFIG.supportEmail}`;

const refundContent = `환불/취소 규정
심의 대행 서비스는 결제 확인 후 자료 검수와 방송국/기관 접수 준비가 시작됩니다.

1. 접수 전 취소
방송국 또는 기관 접수 전에는 결제 취소 또는 환불이 가능합니다.

2. 접수 진행 후 취소
방송국 또는 기관에 자료가 전달된 이후에는 이미 진행된 대행 업무와 외부 접수 비용이 발생하므로 전액 환불이 어려울 수 있습니다.

3. 자료 보완 요청
제출 자료 누락, 파일 오류, 가사 불일치 등으로 보완이 필요한 경우 보완 완료 후 접수가 진행됩니다. 이용자 보완 지연에 따른 일정 지연은 환불 사유가 되지 않습니다.

4. 방송사 결과
심의 결과는 방송국/기관의 판단에 따르며, 부적격 또는 수정 요청 자체는 환불 사유가 아닙니다.

정확한 환불 가능 여부는 접수 상태 확인 후 ${APP_CONFIG.supportEmail}로 안내합니다.`;

const filePolicyContent = `파일 보관/삭제 정책
온사이드는 음원, 영상, 가사, 신청서 등 저작물 자료를 심의 접수와 결과 안내 목적으로만 사용합니다.

1. 보관 목적
심의 접수, 자료 보완, 방송국/기관 제출, 결과 확인, 분쟁 대응 및 증빙 발급을 위해 필요한 범위에서 보관합니다.

2. 접근 제한
업로드 파일은 업무 담당자와 시스템 관리자만 접수 처리 목적에 한해 접근합니다.

3. 삭제 요청
심의 완료 후 파일 삭제가 필요한 경우 신청자 본인 확인을 거쳐 삭제를 요청할 수 있습니다. 단, 법령상 보관 의무가 있는 결제·세금 증빙 기록은 별도 기간 동안 보관될 수 있습니다.

4. 이메일 제출 파일
이메일로 제출한 파일도 온라인 제출 파일과 동일한 기준으로 관리합니다.

파일 삭제 또는 보관 기간 문의는 ${APP_CONFIG.supportEmail}로 접수해주세요.`;

const termsContentEn = `Onside Review Service Terms of Use

Article 1. Purpose
These terms define the conditions for using Onside review services, including album and music video review applications, file submission, payment, progress tracking, and result delivery, as well as the rights and obligations of the company and users.

Article 2. Service Scope
The company provides online application intake, material checks, audio and video file handling, submission support to broadcasters and review organizations, status updates, result or certificate guidance, and payment or receipt support.

Article 3. User Responsibilities
Users must submit audio, video, lyrics, album information, and applicant information that match the actual release or broadcast purpose. Users are responsible for delays or issues caused by false information, missing materials, or rights-infringing materials.

Article 4. File Submission and Storage
Files submitted by upload or email are used only for review submission and result guidance. File storage and deletion follow the separate file storage and deletion policy.

Article 5. Payment and Cancellation
Before payment, users must confirm the selected review type, broadcasters or organizations, total amount, and receipt information. Refunds and cancellations follow the separate refund and cancellation policy.

Article 6. Review Results
Review results and processing times follow each broadcaster or organization's own standards. The company checks and guides submission progress, but does not guarantee approval or any specific result.

Article 7. Guest Lookup
Guest applicants can check progress and results with the issued lookup code. If the lookup code is lost, re-confirmation may be requested using applicant name, email, or other identity information.

Article 8. Changes to Terms
The company may change these terms due to service operation or legal changes. Important changes will be announced on the site.`;

const privacyOfficerNameEn =
  APP_CONFIG.privacyOfficer === "정준영"
    ? "Jung Junyoung"
    : APP_CONFIG.privacyOfficer;

const privacyContentEn = `Onside Privacy Policy

Onside collects and uses personal information only as needed to provide album and music video review application, file submission, payment, progress tracking, and result delivery services.

1. Collected Information
Sign-up: email and password.
Review application: applicant name, phone, email, company or label name, artist name, album, song, video information, payment information, and receipt information.
File submission: audio, video, lyrics, application forms, business registration certificates, and other user-submitted materials.
Service use: access records, lookup codes, payment status, review status, and inquiry history.

2. Purpose of Use
Information is used for review application intake, identity checks, material review, broadcaster or organization submission support, status updates, result and certificate delivery, payment processing, tax invoice or receipt issuance, support inquiries, and abuse prevention.

3. Retention Period
Member information is retained until account deletion or until the service purpose is completed. Records required for review applications, payment, tax evidence, and dispute handling may be retained for legally required periods. Uploaded files follow the file storage and deletion policy.

4. Third-party Provision and Processing Entrustment
Materials required for review submission may be provided or entrusted to broadcasters, review organizations, payment processors, storage providers, and notification services within the scope needed to perform the service. The company does not provide information for unrelated purposes and manages entrusted processors to handle personal information safely.

5. User Rights
Users may request access, correction, deletion, or suspension of processing for their personal information. Information subject to statutory retention obligations may be restricted from deletion during the required period.

6. Security Measures
The company applies technical and administrative measures such as access control, encrypted communication, file access restrictions, and staff access management to protect personal information and submitted materials.

7. Privacy Officer
Privacy Officer: ${privacyOfficerNameEn}
Contact: ${APP_CONFIG.supportEmail}`;

const partnershipContentEn = `Partnership

If you have an original idea, partnership proposal, or business model, you can send us a proposal at any time.

Proposal Process
1. Partnership proposal: Send the proposal by email with required contact information and name.
2. Internal review: Review usually takes 2 to 3 days.
3. Contact: We will contact you about proposals that fit.
4. Selection and execution: If selected, we proceed with contract and execution.

How to Submit
Please send partnership inquiries by email.
${APP_CONFIG.supportEmail}`;

const refundContentEn = `Refund / Cancellation Policy

For review agency services, material checking and broadcaster or organization submission preparation begin after payment confirmation.

1. Cancellation Before Submission
Before submission to a broadcaster or organization, payment cancellation or refund may be possible.

2. Cancellation After Submission Begins
After materials are delivered to a broadcaster or organization, completed agency work and external submission costs may already have occurred, so a full refund may not be possible.

3. Material Supplement Requests
If missing materials, file errors, lyric mismatches, or other issues require supplementation, submission proceeds after supplementation is completed. Delays caused by user supplementation are not grounds for refund.

4. Broadcaster Results
Review results follow broadcaster or organization decisions. Non-approval or revision requests are not refund grounds by themselves.

Refund availability is confirmed based on submission status and guided through ${APP_CONFIG.supportEmail}.`;

const filePolicyContentEn = `File Storage / Deletion Policy

Onside uses copyrighted materials such as audio, video, lyrics, and application forms only for review submission and result guidance.

1. Storage Purpose
Files are stored only within the scope needed for review submission, material supplementation, broadcaster or organization submission, result confirmation, dispute handling, and receipt issuance.

2. Access Restrictions
Uploaded files are accessible only to responsible staff and system administrators for submission handling purposes.

3. Deletion Requests
After review completion, applicants may request file deletion after identity confirmation. Records that must be retained by law, such as payment and tax evidence, may be stored for the required period.

4. Email-submitted Files
Files submitted by email are managed under the same standards as online submitted files.

For file deletion or retention period inquiries, contact ${APP_CONFIG.supportEmail}.`;

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

  React.useEffect(() => {
    if (!activeModal) return;

    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setActiveModal(null);
      }
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [activeModal]);

  React.useEffect(() => {
    setActiveModal(null);
  }, [pathname]);

  return (
    <footer className="border-t-2 border-[#111111] bg-[#111111] text-[#f7f5ef] dark:border-[#f2cf27] dark:bg-[#0b0b0b]">
      <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        <div className="grid gap-5 border-b-2 border-[#f2cf27] pb-5 md:grid-cols-[1.2fr_0.8fr]">
          <div className="space-y-2.5">
            <p className="w-fit bg-[#f2cf27] px-3 py-1 text-xs font-black uppercase tracking-normal text-[#111111]">
              고객센터
            </p>
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
          <div className="space-y-2.5">
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
              <Link href="/about" className={footerLinkClass}>
                회사소개
              </Link>
              <Link href="/guide" className={footerLinkClass}>
                심의 안내
              </Link>
              <Link href="/faq" className={footerLinkClass}>
                FAQ
              </Link>
              <Link href="/support" className={footerLinkClass}>
                고객센터
              </Link>
              <Link href="/forms" className={footerLinkClass}>
                신청서 작성
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
          className="fixed inset-x-0 bottom-0 z-50 flex items-center justify-center bg-black/40 px-4"
          style={{ top: "var(--site-header-height, 76px)" }}
          onClick={closeModal}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={modalTitleId}
            className="w-full max-w-3xl overflow-hidden rounded-[10px] border-2 border-[#111111] bg-[#fffaf0] shadow-[6px_6px_0_#111111]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b-2 border-[#111111] px-4 py-3 sm:px-6 sm:py-4">
              <div className="flex items-center gap-3">
                <span
                  id={modalTitleId}
                  className="border-2 border-[#111111] bg-[#f2cf27] px-3 py-1 text-xs font-black uppercase tracking-normal text-black"
                >
                  {modalTitle}
                </span>
                <span className="text-xs font-black uppercase tracking-normal text-black/60">
                  {modalTag}
                </span>
              </div>
              <button
                type="button"
                onClick={closeModal}
                className="rounded-[8px] border-2 border-[#111111] px-3 py-1 text-xs font-black uppercase tracking-normal text-black transition hover:bg-[#f2cf27]"
              >
                {isEnglishRoute ? "Close" : "닫기"}
              </button>
            </div>
            <div className="max-h-[70vh] overflow-y-auto px-4 py-4 text-xs leading-relaxed text-black/80 whitespace-pre-line sm:px-6 sm:py-5">
              {modalContent}
            </div>
          </div>
        </div>
      )}
    </footer>
  );
}
