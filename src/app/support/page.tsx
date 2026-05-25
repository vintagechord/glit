import Link from "next/link";

import { APP_CONFIG } from "@/lib/config";

export const metadata = {
  title: "고객센터",
};

const supportCards = [
  {
    title: "신청 전 상담",
    description: "목적과 송출처에 맞는 심의 유형을 확인합니다.",
  },
  {
    title: "자료 보완",
    description: "가사, 번역, 영상 규격, CD 제출 여부를 확인합니다.",
  },
  {
    title: "결과/코드 문의",
    description: "조회 코드와 결과 파일 확인을 도와드립니다.",
  },
];

export default function SupportPage() {
  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-12">
      <p className="bauhaus-kicker">고객센터</p>
      <h1 className="font-display mt-4 text-3xl font-black text-foreground">
        접수 전후로 필요한 문의를 한 곳에서 확인하세요
      </h1>
      <p className="mt-3 max-w-3xl text-sm font-semibold leading-6 text-muted-foreground">
        온라인 접수를 기본으로 운영하며, 파일 업로드가 어려운 경우 구버전 신청서 작성 방식도 안내합니다.
      </p>

      <section className="mt-8 grid gap-4 md:grid-cols-3">
        {supportCards.map((card) => (
          <div
            key={card.title}
            className="rounded-[10px] border-2 border-[#111111] bg-card p-5 shadow-[5px_5px_0_#111111] dark:border-[#f2cf27] dark:shadow-[5px_5px_0_#f2cf27]"
          >
            <h2 className="text-lg font-black text-foreground">{card.title}</h2>
            <p className="mt-2 text-sm font-semibold leading-6 text-muted-foreground">
              {card.description}
            </p>
          </div>
        ))}
      </section>

      <section className="mt-8 grid gap-5 rounded-[10px] border-2 border-[#111111] bg-card p-6 shadow-[6px_6px_0_#111111] dark:border-[#f2cf27] dark:shadow-[6px_6px_0_#f2cf27] lg:grid-cols-[0.9fr_1.1fr]">
        <div>
          <p className="text-xs font-black uppercase tracking-normal text-muted-foreground">
            연락처
          </p>
          <div className="mt-4 space-y-2 text-base font-semibold text-foreground">
            <p>
              전화{" "}
              <a href={`tel:${APP_CONFIG.supportPhone}`} className="underline-offset-2 hover:underline">
                {APP_CONFIG.supportPhone}
              </a>
            </p>
            <p>
              이메일{" "}
              <a href={`mailto:${APP_CONFIG.supportEmail}`} className="underline-offset-2 hover:underline">
                {APP_CONFIG.supportEmail}
              </a>
            </p>
            <p className="text-sm text-muted-foreground">
              상담시간 {APP_CONFIG.supportHours}
            </p>
          </div>
        </div>
        <div>
          <p className="text-xs font-black uppercase tracking-normal text-muted-foreground">
            빠른 이동
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link href="/dashboard/new" className="bauhaus-button px-5 py-3 text-sm">
              온라인 심의 신청
            </Link>
            <Link
              href="/track"
              className="inline-flex items-center rounded-[8px] border-2 border-[#111111] bg-background px-5 py-3 text-sm font-black text-foreground shadow-[3px_3px_0_#111111] transition hover:-translate-y-0.5"
            >
              진행/결과 조회
            </Link>
            <Link
              href="/forms"
              className="inline-flex items-center rounded-[8px] border-2 border-[#111111] bg-background px-5 py-3 text-sm font-black text-foreground shadow-[3px_3px_0_#111111] transition hover:-translate-y-0.5"
            >
              구버전 신청서 작성
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
