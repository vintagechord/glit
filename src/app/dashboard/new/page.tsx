import Link from "next/link";

import { APP_CONFIG } from "@/lib/config";

export const metadata = {
  title: "새 심의 접수",
};

const submissionCards = [
  {
    eyebrow: "Broadcast Review Submission",
    title: "음반 심의",
    description: "트랙 정보 입력부터 패키지 선택, 음원 제출까지 순서대로 진행합니다.",
    href: "/dashboard/new/album",
    tone: "border-[#111111] bg-[#f2cf27] text-[#111111] shadow-[6px_6px_0_#111111] dark:border-[#f2cf27] dark:bg-[#f2cf27] dark:text-[#111111] dark:shadow-[6px_6px_0_#f2cf27]",
  },
  {
    eyebrow: "M/V Review",
    title: "M/V 심의",
    description: "TV 송출용과 온라인 업로드용을 구분해 필요한 항목만 접수할 수 있습니다.",
    href: "/dashboard/new/mv",
    tone: "border-[#111111] bg-[#1556a4] text-white shadow-[6px_6px_0_#111111] dark:border-[#f2cf27] dark:bg-[#3f8ad8] dark:text-[#06111f] dark:shadow-[6px_6px_0_#f2cf27]",
  },
  {
    eyebrow: "One Click",
    title: "원클릭 접수",
    description: "발매 음원의 멜론 링크와 음원 파일 중심으로 빠르게 접수하는 방식입니다.",
    href: "/dashboard/new/album?mode=oneclick",
    tone: "border-[#111111] bg-[#d9362c] text-white shadow-[6px_6px_0_#111111] dark:border-[#f2cf27] dark:bg-[#ff6258] dark:text-[#111111] dark:shadow-[6px_6px_0_#f2cf27]",
  },
];

export default function NewSubmissionPage() {
  return (
    <div className="page-centered mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
      <section className="relative overflow-hidden rounded-[10px] border-2 border-[#111111] bg-card px-6 py-8 shadow-[8px_8px_0_#111111] dark:border-[#f2cf27] dark:shadow-[8px_8px_0_#f2cf27] sm:px-8 sm:py-10">
        <p className="bauhaus-kicker">
          New Submission
        </p>
        <h1 className="font-display mt-4 text-3xl font-black leading-tight text-foreground sm:text-4xl">
          접수 유형을 선택하세요
        </h1>
        <ul className="mt-4 space-y-2 text-sm font-semibold text-muted-foreground sm:text-base">
          <li>비회원도 바로 접수할 수 있습니다.</li>
          <li>로그인 상태로 접수하면 내역이 마이페이지에 자동 저장됩니다.</li>
          <li>원하시는 접수 방식만 고르면 바로 다음 단계로 이어집니다.</li>
        </ul>

        <div className="mt-8 grid gap-5 md:grid-cols-3">
          {submissionCards.map((card) => (
            <Link
              key={card.href}
              href={card.href}
              className={`group rounded-[10px] border-2 p-6 transition duration-200 hover:-translate-y-1 hover:shadow-[9px_9px_0_#111111] ${card.tone}`}
            >
              <p className="text-[11px] font-black uppercase tracking-normal opacity-75">
                {card.eyebrow}
              </p>
              <h2 className="mt-4 text-[28px] font-black tracking-normal">
                {card.title}
              </h2>
              <p className="mt-3 text-sm font-semibold leading-6 opacity-82">{card.description}</p>
              <div className="mt-6 inline-flex items-center gap-2 border-2 border-current bg-white px-4 py-2 text-sm font-black text-[#111111]">
                바로 시작
                <span className="transition-transform duration-200 group-hover:translate-x-1">
                  →
                </span>
              </div>
            </Link>
          ))}
        </div>
      </section>
      <div className="mt-5 rounded-[10px] border-2 border-[#111111] bg-white px-5 py-4 text-sm font-semibold text-muted-foreground shadow-[5px_5px_0_#111111] dark:border-[#f2cf27] dark:bg-[#171717] dark:shadow-[5px_5px_0_#f2cf27]">
        파일 업로드가 원활하지 않으면 신청서는 사이트에서 계속 진행하시고,
        파일만 이메일로 별도 제출해주세요.
        <p className="mt-2 font-semibold text-foreground">{APP_CONFIG.supportEmail}</p>
      </div>
    </div>
  );
}
