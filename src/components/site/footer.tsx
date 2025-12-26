import Link from "next/link";

import { APP_CONFIG } from "@/lib/config";

export function SiteFooter() {
  return (
    <footer className="border-t border-border/60 bg-background/80">
      <div className="mx-auto w-full max-w-6xl px-6 py-10">
        <div className="grid gap-6 border-b border-border/60 pb-6 md:grid-cols-2">
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
              CS CENTER
            </p>
            <p className="text-2xl font-semibold text-foreground">
              {APP_CONFIG.supportPhone}
            </p>
            <p className="text-sm text-muted-foreground">
              이메일 {APP_CONFIG.supportEmail}
            </p>
            <p className="text-sm text-muted-foreground">
              상담시간 {APP_CONFIG.supportHours}
            </p>
          </div>
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
              BANK INFO
            </p>
            <p className="text-sm text-muted-foreground">
              예금주: <span className="font-semibold">{APP_CONFIG.bankHolder}</span>
            </p>
            <p className="text-sm text-muted-foreground">
              {APP_CONFIG.bankName} {APP_CONFIG.bankAccount}
            </p>
            {APP_CONFIG.bankLink ? (
              <Link
                href={APP_CONFIG.bankLink}
                className="inline-flex items-center rounded-full border border-border/70 px-3 py-1 text-xs font-semibold text-foreground transition hover:border-foreground"
              >
                인터넷뱅킹 바로가기
              </Link>
            ) : null}
          </div>
        </div>

        <div className="flex flex-wrap gap-4 border-b border-border/60 py-4 text-xs text-muted-foreground">
          <Link href="/about" className="transition hover:text-foreground">
            About Us
          </Link>
          <span>회사소개</span>
          <span>이용약관</span>
          <span>개인정보처리방침</span>
          <span>이용안내</span>
          <span>제휴안내</span>
        </div>

        <div className="space-y-2 pt-4 text-xs text-muted-foreground">
          <p>
            회사명: {APP_CONFIG.businessName} · 대표자:{" "}
            {APP_CONFIG.businessRep} · 주소: {APP_CONFIG.businessAddress} · 전화:{" "}
            {APP_CONFIG.supportPhone} · 이메일: {APP_CONFIG.supportEmail}
          </p>
          <p>
            사업자등록번호: {APP_CONFIG.businessRegNo} · 통신판매업신고번호:{" "}
            {APP_CONFIG.businessMailOrderNo} · 개인정보 보호책임자:{" "}
            {APP_CONFIG.privacyOfficer} · 호스팅 제공자:{" "}
            {APP_CONFIG.hostingProvider}
          </p>
          <p>Copyright © {APP_CONFIG.businessName}. All Rights Reserved.</p>
        </div>
      </div>
    </footer>
  );
}
