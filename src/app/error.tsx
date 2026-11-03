"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Site-wide fallback for errors thrown by a page (the root layout's header and
// footer stay in place). Errors in the root layout itself reach global-error.
export default function SiteError({
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  const english = /^\/en(?:\/|$)/.test(usePathname() ?? "");

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-12">
      <div className="rounded-[10px] border-2 border-[#111111] bg-card p-6 shadow-[8px_8px_0_#111111] dark:border-[#f2cf27] dark:shadow-[8px_8px_0_#f2cf27]">
        <p className="bauhaus-kicker">{english ? "Error" : "오류"}</p>
        <h1 className="mt-4 text-2xl font-black text-foreground">
          {english ? "This page could not be loaded" : "페이지를 불러오지 못했습니다"}
        </h1>
        <p className="mt-3 text-sm font-semibold leading-6 text-muted-foreground">
          {english
            ? "The network or server responded slowly. If the page still does not open, please contact support."
            : "네트워크 또는 서버 응답 지연이 발생했습니다. 다시 시도해도 열리지 않으면 고객센터로 문의해주세요."}
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <button type="button" onClick={retry} className="bauhaus-button px-5 py-3 text-sm">
            {english ? "Try again" : "다시 불러오기"}
          </button>
          <Link href={english ? "/en" : "/"} className="bauhaus-button px-5 py-3 text-sm">
            {english ? "Go to home" : "홈으로"}
          </Link>
        </div>
      </div>
    </div>
  );
}
