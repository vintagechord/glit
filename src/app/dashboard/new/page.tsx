import Link from "next/link";
import { ArrowRight, Disc3, FileText, Film } from "lucide-react";

export const metadata = {
  title: "새 심의 접수",
};

const submissionCards = [
  {
    title: "음반 심의 신청",
    description: "방송 송출을 위한 음반 심의 접수입니다.",
    href: "/dashboard/new/album",
    icon: Disc3,
    details: ["앨범 정보", "수록곡/가사", "음원 파일"],
  },
  {
    title: "뮤비 심의 신청",
    description: "온라인 업로드용 또는 방송 송출용 MV 심의 접수입니다.",
    href: "/dashboard/new/mv",
    icon: Film,
    details: ["영상 정보", "가사/제작 정보", "영상 파일"],
  },
];

export default function NewSubmissionPage() {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 sm:py-12">
      <div className="mb-7">
        <p className="text-sm font-semibold text-[#2f6f9f]">New Submission</p>
        <h1 className="mt-3 text-2xl font-semibold text-[#2f3a4d] sm:text-3xl">
          접수 유형 선택
        </h1>
        <p className="mt-2 text-sm leading-6 text-[#667085]">
          필요한 심의를 선택하면 신청서로 바로 이동합니다.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {submissionCards.map((card) => {
          const Icon = card.icon;
          return (
            <Link
              key={card.href}
              href={card.href}
              className="group rounded-[8px] border border-[#d8e1ef] bg-white p-5 transition hover:border-[#2f6f9f] hover:bg-[#f7fbff] sm:p-6"
            >
              <div className="flex items-start justify-between gap-4">
                <span className="flex h-12 w-12 items-center justify-center rounded-[8px] bg-[#edf4f7] text-[#2f6f9f]">
                  <Icon className="h-6 w-6" aria-hidden />
                </span>
                <ArrowRight
                  className="mt-1 h-5 w-5 text-[#2f6f9f] transition group-hover:translate-x-0.5"
                  aria-hidden
                />
              </div>
              <h2 className="mt-5 text-xl font-semibold text-[#2f3a4d]">
                {card.title}
              </h2>
              <p className="mt-2 break-keep text-sm leading-6 text-[#667085]">
                {card.description}
              </p>
              <div className="mt-5 flex flex-wrap gap-2">
                {card.details.map((detail) => (
                  <span
                    key={detail}
                    className="rounded-full bg-[#eef3f8] px-3 py-1 text-xs font-medium text-[#526071]"
                  >
                    {detail}
                  </span>
                ))}
              </div>
            </Link>
          );
        })}
      </div>

      <div className="mt-5 grid gap-4 rounded-[8px] border border-[#d8e1ef] bg-white p-5 text-sm leading-6 text-[#667085] sm:grid-cols-[1fr_auto] sm:items-center">
        <div className="flex gap-3">
          <FileText className="mt-1 h-4 w-4 shrink-0 text-[#2f6f9f]" aria-hidden />
          <div>
            <p className="font-semibold text-[#2f3a4d]">
              이메일 전송 방식도 계속 이용할 수 있습니다.
            </p>
            <p className="mt-1">
              구버전 신청서로 접수하려면 서식을 내려받아 이메일로 보내주세요.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 sm:justify-end">
          <Link
            href="/forms"
            className="inline-flex h-10 items-center rounded-[8px] border border-[#c9d6e8] px-4 font-semibold text-[#2f3a4d] transition hover:border-[#2f6f9f] hover:text-[#2f6f9f]"
          >
            구버전(이메일) 접수
          </Link>
        </div>
      </div>
    </div>
  );
}
