import { Clapperboard, Disc3, Tv } from "lucide-react";

import { ReliableLink } from "@/components/site/reliable-link";

export const metadata = {
  title: "새 심의 접수",
};

const submissionCards = [
  {
    meta: "음원 · 라디오/TV",
    title: "음반 심의",
    description: "방송 송출용 음원을 접수합니다.",
    href: "/dashboard/new/album",
    icon: Disc3,
    tone: "border-[#111111] bg-[#f2cf27] text-[#111111] shadow-[6px_6px_0_#111111] dark:border-[#f2cf27] dark:bg-[#f2cf27] dark:text-[#111111] dark:shadow-[6px_6px_0_#f2cf27]",
  },
  {
    meta: "유통 · 온라인 업로드",
    title: "뮤직비디오 온라인 심의",
    description: "유통·업로드용 등급 심의입니다.",
    href: "/dashboard/new/mv",
    icon: Clapperboard,
    tone: "border-[#111111] bg-[#1556a4] text-white shadow-[6px_6px_0_#111111] dark:border-[#f2cf27] dark:bg-[#3f8ad8] dark:text-[#06111f] dark:shadow-[6px_6px_0_#f2cf27]",
  },
  {
    meta: "방송국 · TV 송출",
    title: "뮤직비디오 TV 송출 심의",
    description: "방송국 송출용 영상을 접수합니다.",
    href: "/dashboard/new/mv?type=broadcast",
    icon: Tv,
    tone: "border-[#111111] bg-[#d9362c] text-white shadow-[6px_6px_0_#111111] dark:border-[#f2cf27] dark:bg-[#ff6258] dark:text-[#111111] dark:shadow-[6px_6px_0_#f2cf27]",
  },
];

export default function NewSubmissionPage() {
  return (
    <div className="page-centered mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
      <section className="relative overflow-hidden rounded-[10px] border-2 border-[#111111] bg-card px-6 py-8 shadow-[8px_8px_0_#111111] dark:border-[#f2cf27] dark:shadow-[8px_8px_0_#f2cf27] sm:px-8 sm:py-10">
        <p className="bauhaus-kicker">심의 신청</p>
        <h1 className="font-display mt-4 text-3xl font-black leading-tight text-foreground sm:text-4xl">
          무엇을 신청하시나요?
        </h1>
        <div className="mt-4 flex flex-wrap gap-2" aria-label="접수 특징">
          <span className="rounded-full border border-border bg-background px-3 py-1 text-xs font-black text-foreground">
            비회원 가능
          </span>
          <span className="rounded-full border border-border bg-background px-3 py-1 text-xs font-black text-foreground">
            로그인 시 자동 저장
          </span>
        </div>

        <div className="mt-8 grid gap-5 md:grid-cols-3">
          {submissionCards.map((card) => (
            <ReliableLink
              key={card.href}
              href={card.href}
              className={`group rounded-[10px] border-2 p-6 transition duration-200 hover:-translate-y-1 hover:shadow-[9px_9px_0_#111111] ${card.tone}`}
            >
              <card.icon className="h-7 w-7" aria-hidden="true" />
              <p className="mt-3 text-[11px] font-black uppercase tracking-normal opacity-75">
                {card.meta}
              </p>
              <h2 className="mt-4 text-[28px] font-black tracking-normal">
                {card.title}
              </h2>
              <p className="mt-3 text-sm font-semibold leading-6 opacity-82">{card.description}</p>
              <div className="mt-6 inline-flex items-center gap-2 border-2 border-current bg-white px-4 py-2 text-sm font-black text-[#111111]">
                신청하기
                <span className="transition-transform duration-200 group-hover:translate-x-1">
                  →
                </span>
              </div>
            </ReliableLink>
          ))}
        </div>
      </section>
      <div className="mt-4 text-right text-xs font-semibold text-muted-foreground">
        <ReliableLink
          href="https://onside17.com/"
          target="_blank"
          rel="noopener noreferrer"
          className="underline-offset-4 transition hover:text-foreground hover:underline"
        >
          기존 사이트 접수
        </ReliableLink>
      </div>
    </div>
  );
}
