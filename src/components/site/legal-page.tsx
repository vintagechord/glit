import Link from "next/link";
import { privacyContent, privacyContentEn, termsContent, termsContentEn } from "@/lib/legal-content";

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
        <nav aria-label={english ? "Policies" : "약관 및 정책"} className="mt-8 flex flex-wrap gap-4 border-t-2 border-border pt-5 text-sm font-bold">
          <Link href={`${prefix}/terms`} aria-current={policy === "terms" ? "page" : undefined} className="underline underline-offset-4">{english ? "Terms of Use" : "이용약관"}</Link>
          <Link href={`${prefix}/privacy`} aria-current={policy === "privacy" ? "page" : undefined} className="underline underline-offset-4">{english ? "Privacy Policy" : "개인정보처리방침"}</Link>
          <Link href={prefix || "/"} className="underline underline-offset-4">{english ? "Home" : "홈으로"}</Link>
        </nav>
      </div>
    </article>
  );
}
