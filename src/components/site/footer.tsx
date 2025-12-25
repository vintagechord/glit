import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="border-t border-border/60 bg-background/80">
      <div className="mx-auto grid w-full max-w-6xl gap-6 px-6 py-10 md:grid-cols-[1.2fr_1fr_1fr]">
        <div className="space-y-3">
          <p className="text-sm font-semibold tracking-[0.3em] text-foreground">
            ONSIDE
          </p>
          <p className="text-sm text-muted-foreground">
            음원/뮤직비디오 심의 접수와 진행 상황을 한 번에 관리하는 온라인
            플랫폼.
          </p>
          <p className="text-xs text-muted-foreground">
            대표 메일: onside17@daum.net
          </p>
        </div>
        <div className="space-y-2 text-sm text-muted-foreground">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-foreground">
            서비스
          </p>
          <Link href="/guide" className="block hover:text-foreground">
            심의 안내
          </Link>
          <Link href="/dashboard/new" className="block hover:text-foreground">
            온라인 접수
          </Link>
          <Link href="/forms" className="block hover:text-foreground">
            신청서 다운로드
          </Link>
        </div>
        <div className="space-y-2 text-sm text-muted-foreground">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-foreground">
            안내
          </p>
          <p>운영시간: 평일 10:00 - 18:00</p>
          <p>무통장 입금 안내 및 확인은 관리자 승인 후 처리됩니다.</p>
        </div>
      </div>
    </footer>
  );
}
