import { Archive, ArrowUpRight, Disc3, Radio } from "lucide-react";

import { ReliableLink } from "@/components/site/reliable-link";

const advantages = [
  {
    icon: Radio,
    number: "01",
    title: "내 음악을 위한 방송 신청 가이드",
    description: "심의 완료 후, 내 곡과 심의 결과에 맞춘 방송국별 신청 방법을 안내합니다.",
    href: "/mypage/history",
    color: "bg-[#1556a4] text-white",
  },
  {
    icon: Archive,
    number: "02",
    title: "쌓이는 음악, 남아 있는 심의 기록",
    description: "온사이드에서 진행한 모든 심의와 결과를 내 계정에서 계속 보관하고 확인하세요.",
    href: "/mypage/history",
    color: "bg-[#f2cf27] text-[#111111]",
  },
  {
    icon: Disc3,
    number: "03",
    title: "CD·LP·굿즈 판매는 아트멜론으로",
    description: "실물 판매를 지원하지 않는 유통사를 이용해도, 심의 회원을 위한 입점 연계로 다음 단계를 준비하세요.",
    href: "/support#artmelon",
    color: "bg-[#d9362c] text-white",
  },
];

export function HomeHeroAdBanner() {
  return (
    <section
      aria-label="온사이드와 함께하는 심의 그 다음"
      className="w-full max-w-[540px] overflow-hidden rounded-[10px] border-2 border-[#111111] bg-white shadow-[4px_4px_0_#111111] dark:border-[#f2cf27] dark:bg-[#171717] dark:shadow-[4px_4px_0_#f2cf27]"
    >
      <div className="flex items-center justify-between gap-3 border-b-2 border-[#111111] bg-[#111111] px-4 py-3 text-white dark:border-[#f2cf27]">
        <p className="text-sm font-black">심의 그 다음까지, 온사이드</p>
        <span className="text-[10px] font-black tracking-[0.12em] text-[#f2cf27]">BEYOND REVIEW</span>
      </div>
      <div className="divide-y divide-[#111111]/15 dark:divide-white/15">
        {advantages.map(({ icon: Icon, number, title, description, href, color }) => (
          <ReliableLink
            key={number}
            href={href}
            className="group flex items-start gap-3 px-4 py-3.5 transition hover:bg-[#f2cf27]/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#1556a4]"
          >
            <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[7px] border-2 border-[#111111] ${color}`}>
              <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-start justify-between gap-2 text-[13px] font-black leading-5 text-foreground sm:text-sm">
                {title}
                <ArrowUpRight className="mt-0.5 h-4 w-4 shrink-0 transition group-hover:-translate-y-0.5 group-hover:translate-x-0.5" aria-hidden="true" />
              </span>
              <span className="mt-1 block break-keep text-xs leading-[1.65] text-muted-foreground">
                {description}
              </span>
            </span>
          </ReliableLink>
        ))}
      </div>
    </section>
  );
}
