import Link from "next/link";

import { APP_CONFIG } from "@/lib/config";
import { formatKoreanDate, GUIDE_CONTENT_UPDATED, ONSIDE_TRUST_FACTS, type TrustFact } from "@/lib/onside-trust";

/** Who runs Onside and how payment, refunds and progress work, on every search landing page. */
export function GuideTrustFacts({ heading = "온사이드 접수·결제·환불 기준", leadFacts = [] }: { heading?: string; leadFacts?: TrustFact[] }) {
  return (
    <section className="mt-10" aria-labelledby="onside-trust-heading">
      <h2 id="onside-trust-heading" className="font-display break-keep text-2xl font-black text-foreground">{heading}</h2>
      <dl className="mt-4 overflow-hidden rounded-[8px] border-2 border-[#111111] dark:border-[#f2cf27]/60">
        {[...leadFacts, ...ONSIDE_TRUST_FACTS].map((fact, index) => (
          <div key={fact.label} className={`grid gap-1 bg-card px-4 py-3 sm:grid-cols-[7rem_1fr] sm:gap-4 ${index > 0 ? "border-t-2 border-[#111111] dark:border-[#f2cf27]/40" : ""}`}>
            <dt className="text-xs font-black text-muted-foreground sm:text-sm">{fact.label}</dt>
            <dd className="break-keep text-sm font-bold leading-6 text-foreground">{fact.value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 break-keep text-xs leading-6 text-muted-foreground">
        사업자등록번호 {APP_CONFIG.businessRegNo} · 통신판매업신고 {APP_CONFIG.businessMailOrderNo} ·{" "}
        <Link href="/terms" className="font-bold underline underline-offset-4">이용약관</Link>과{" "}
        <Link href="/terms#refund" className="font-bold underline underline-offset-4">환불/취소 규정</Link>을 따릅니다.
      </p>
    </section>
  );
}

/** Small freshness line under a guide's heading: when the facts were last checked, and by whom. */
export function GuideUpdatedLine() {
  return (
    <p className="mt-3 text-xs font-bold text-muted-foreground">
      <time dateTime={GUIDE_CONTENT_UPDATED}>{formatKoreanDate(GUIDE_CONTENT_UPDATED)}</time> 업데이트 · 온사이드 심의 안내
    </p>
  );
}
