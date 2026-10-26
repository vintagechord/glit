import { Clapperboard, Disc3, Tv } from "lucide-react";

import { ReliableLink } from "@/components/site/reliable-link";
import { reviewServices } from "@/lib/onside-content";

export const metadata = {
  title: "새 심의 접수",
};

const submissionCards = [
  {
    meta: "음원 · 라디오/TV",
    title: "음반 심의 접수",
    description: "발매 여부를 선택하면 알맞은 접수 방법으로 안내합니다.",
    href: "/dashboard/new/album",
    icon: Disc3,
    tone: "border-[#111111] bg-[#f2cf27] text-[#111111] shadow-[6px_6px_0_#111111] dark:border-[#f2cf27] dark:bg-[#f2cf27] dark:text-[#111111] dark:shadow-[6px_6px_0_#f2cf27]",
  },
  {
    meta: "유통 · 온라인 업로드",
    title: "뮤직비디오 온라인 심의",
    description: "유통·업로드용 등급 심의입니다.",
    href: "/dashboard/new/mv?type=distribution",
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
      <section className="relative overflow-hidden rounded-[10px] border-2 border-[#111111] bg-card px-4 py-6 shadow-[8px_8px_0_#111111] dark:border-[#f2cf27] dark:shadow-[8px_8px_0_#f2cf27] sm:px-8 sm:py-10">
        <p className="bauhaus-kicker">심의 신청</p>
        <h1 className="font-display mt-4 break-keep text-balance text-2xl font-black leading-tight text-foreground sm:text-4xl">
          무엇을 신청하시나요?
        </h1>
        <div className="mt-6 grid gap-4 lg:grid-cols-3 sm:mt-8 sm:gap-5">
          {submissionCards.map((card, index) => (
            <ReliableLink
              key={card.href}
              href={card.href}
              className={`group flex min-w-0 flex-col rounded-[10px] border-2 p-4 sm:p-6 transition duration-200 hover:-translate-y-1 hover:shadow-[9px_9px_0_#111111] ${card.tone}`}
            >
              <card.icon className="h-7 w-7" aria-hidden="true" />
              <p className="mt-3 text-sm font-black tracking-normal">
                {card.meta}
              </p>
              <h2 className="mt-4 break-keep text-balance text-2xl font-black leading-snug tracking-normal sm:text-[28px]">
                {reviewServices[index].title}
              </h2>
              <p className="mb-6 mt-3 text-sm font-semibold leading-6">{reviewServices[index].purpose}</p>
              <div className="mt-auto inline-flex w-fit items-center gap-2 border-2 border-current bg-white px-4 py-2 text-sm font-black text-[#111111]">
                신청하기
                <span className="transition-transform duration-200 group-hover:translate-x-1">
                  →
                </span>
              </div>
            </ReliableLink>
          ))}
        </div>
        <div className="mt-6 flex flex-wrap items-center justify-between gap-4">
          <span className="rounded-full border border-border bg-background px-3 py-1 text-xs font-black text-foreground">
            비회원 가능
          </span>
          <ReliableLink href="/support" target="_blank" rel="noopener noreferrer" className="bauhaus-button min-h-11 px-5 py-2 text-sm">
            문의하기
          </ReliableLink>
        </div>
        <details className="mt-6 rounded-[8px] border border-border p-4">
          <summary className="cursor-pointer text-base font-bold">어떤 심의가 필요한지 모르겠어요</summary>
          <p className="mt-3 text-sm leading-6">공개할 곳, 제출할 방송사·유통사, 요청받은 서류 이름을 확인해주세요. 음원인지 영상인지와 제출처의 요구사항을 기준으로 안내해 드립니다.</p>
        </details>
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
