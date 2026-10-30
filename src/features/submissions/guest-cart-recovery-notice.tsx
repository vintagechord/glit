"use client";

import * as React from "react";
import type { GuestSubmissionCartEntry } from "@/lib/guest-submission-cart";

/** Keep guest credentials visible if browser storage prevents the cart handoff,
 * and show them again in the cart so a guest can return from another device. */
export function GuestCartRecoveryNotice({ entries, localePrefix, variant = "recovery" }: {
  entries: GuestSubmissionCartEntry[];
  localePrefix: string;
  variant?: "recovery" | "cart";
}) {
  const [copyStatus, setCopyStatus] = React.useState("");
  if (!entries.length) return null;
  // The cart already has a checkout <aside>; render the cart variant as a region.
  const Wrapper: "aside" | "section" = variant === "cart" ? "section" : "aside";
  return <Wrapper aria-label={variant === "cart" ? "비회원 조회 코드 안내" : "비회원 신청서 저장 안내"} className="rounded-2xl border border-amber-600/40 bg-amber-50 p-4 text-sm text-amber-950 dark:bg-amber-950/30 dark:text-amber-100">
    <p className="font-semibold">{variant === "cart" ? "비회원 신청서는 조회 코드로 확인합니다." : "조회 코드를 먼저 보관해주세요."}</p>
    <p className="mt-2 leading-6">{variant === "cart"
      ? "이 브라우저 저장소가 지워지거나 다른 기기에서 열면 장바구니가 비어 보입니다. 아래 조회 코드를 보관해두면 결제 전에도 신청서를 다시 열 수 있습니다. 접수자 이메일로도 조회 링크를 보내드렸습니다."
      : "신청서는 서버에 저장되었습니다. 브라우저 저장을 허용한 뒤 장바구니에 다시 담거나, 아래 조회 코드로 저장된 신청서를 확인할 수 있습니다."}</p>
    <ul className="mt-3 space-y-3">{entries.map(entry=><li key={entry.submissionId} className="space-y-2">
      <p data-no-translate className="break-all font-mono">{entry.guestToken}</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="min-h-11 rounded-full border border-current px-4 py-2" onClick={async()=>{
          try { await navigator.clipboard.writeText(entry.guestToken); setCopyStatus("조회 코드를 복사했습니다."); }
          catch { setCopyStatus("복사하지 못했습니다. 조회 코드를 선택해 복사해주세요."); }
        }}>조회 코드 복사</button>
        <a href={`${localePrefix}/track/${encodeURIComponent(entry.guestToken)}`} className="inline-flex min-h-11 items-center rounded-full border border-current px-4 py-2">저장된 신청서 조회</a>
      </div>
    </li>)}</ul>
    <p role="status" className="mt-2 text-xs">{copyStatus}</p>
  </Wrapper>;
}
