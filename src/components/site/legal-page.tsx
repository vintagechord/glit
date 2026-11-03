import Link from "next/link";
import {
  filePolicyContent,
  filePolicyContentEn,
  privacyContent,
  privacyContentEn,
  refundContent,
  refundContentEn,
  termsContent,
  termsContentEn,
} from "@/lib/legal-content";

// The terms defer refunds and file retention to these separate rules. They are
// published below the terms so the footer links reach them without JavaScript.
const termsAppendices = [
  { id: "refund", content: refundContent, contentEn: refundContentEn, label: "환불/취소 규정", labelEn: "Refund / Cancellation Policy" },
  { id: "file-policy", content: filePolicyContent, contentEn: filePolicyContentEn, label: "파일 보관/삭제 정책", labelEn: "File Storage / Deletion Policy" },
];

export function LegalPage({ policy, english = false }: { policy: "privacy" | "terms"; english?: boolean }) {
  const content = policy === "privacy"
    ? (english ? privacyContentEn : privacyContent)
    : (english ? termsContentEn : termsContent);
  const firstParagraph = content.indexOf("\n\n");
  const prefix = english ? "/en" : "";
  return (
    <article lang={english ? "en" : "ko"} className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-6 sm:py-16">
      <div className="rounded-[10px] border-2 border-[#111111] bg-card p-5 shadow-[6px_6px_0_#111111] dark:border-[#f2cf27] dark:shadow-[6px_6px_0_#f2cf27] sm:p-8">
        <h1 className="font-display text-2xl font-black leading-tight sm:text-3xl">{content.slice(0, firstParagraph)}</h1>
        <div className="mt-7 whitespace-pre-wrap break-words text-sm leading-7 text-foreground" data-no-translate>{content.slice(firstParagraph + 2)}</div>
        {policy === "terms" ? termsAppendices.map((appendix) => {
          const text = english ? appendix.contentEn : appendix.content;
          const titleEnd = text.indexOf("\n");
          return (
            <section key={appendix.id} id={appendix.id} aria-labelledby={`${appendix.id}-title`} className="mt-10 scroll-mt-[calc(var(--site-header-height,112px)+1rem)] border-t-2 border-border pt-7">
              <h2 id={`${appendix.id}-title`} className="font-display text-xl font-black leading-tight sm:text-2xl">{text.slice(0, titleEnd)}</h2>
              <div className="mt-5 whitespace-pre-wrap break-words text-sm leading-7 text-foreground" data-no-translate>{text.slice(titleEnd + 1).trim()}</div>
            </section>
          );
        }) : null}
        <nav aria-label={english ? "Policies" : "약관 및 정책"} className="mt-8 flex flex-wrap gap-4 border-t-2 border-border pt-5 text-sm font-bold">
          <Link href={`${prefix}/terms`} aria-current={policy === "terms" ? "page" : undefined} className="underline underline-offset-4">{english ? "Terms of Use" : "이용약관"}</Link>
          <Link href={`${prefix}/privacy`} aria-current={policy === "privacy" ? "page" : undefined} className="underline underline-offset-4">{english ? "Privacy Policy" : "개인정보처리방침"}</Link>
          {termsAppendices.map((appendix) => (
            <Link key={appendix.id} href={`${prefix}/terms#${appendix.id}`} className="underline underline-offset-4">{english ? appendix.labelEn : appendix.label}</Link>
          ))}
          <Link href={prefix || "/"} className="underline underline-offset-4">{english ? "Home" : "홈으로"}</Link>
        </nav>
      </div>
    </article>
  );
}
