import { Clock3, Mail, Phone } from "lucide-react";
import Link from "next/link";

import { APP_CONFIG } from "@/lib/config";
import { SupportInquiryModal } from "@/features/support/support-inquiry-modal";
import { ArtmelonOnboarding } from "@/features/support/artmelon-onboarding";

export function SupportPageView({ localePrefix = "" }: { localePrefix?: string } = {}) {
  const helpTopics = [
    {
      title: "파일 업로드 문제",
      description: "실패한 파일은 신청 화면에서 재시도하거나 이메일 제출을 선택할 수 있습니다. 해결되지 않으면 파일명과 오류 내용을 알려주세요.",
      action: "업로드 문제 문의",
    },
    {
      title: "입금 확인",
      description: "주문내역에서 입금 계좌와 확인 상태를 확인하세요. 입금 후 상태가 바뀌지 않으면 주문번호와 입금자명을 알려주세요.",
      action: "주문·입금 상태 보기",
      href: "/mypage/orders",
    },
    {
      title: "보완 자료 제출",
      description: "접수 상세의 보완 요청 항목을 확인하고 요청된 자료를 제출하세요. 요청 내용을 찾지 못하면 접수번호로 문의해주세요.",
      action: "접수 조회 후 보완하기",
      href: "/track",
    },
    {
      title: "심의 진행·결과 조회",
      description: "회원은 로그인, 비회원은 조회 코드로 진행상황과 결과를 확인할 수 있습니다. 조회 코드 복구도 조회 화면에서 진행하세요.",
      action: "진행·결과 조회",
      href: "/track",
    },
  ];
  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-12">
      <p className="bauhaus-kicker">고객센터</p>
      <h1 className="font-display mt-4 text-3xl font-black text-foreground">
        어떻게 도와드릴까요?
      </h1>

      <section aria-labelledby="support-help-title" className="mt-8">
        <h2 id="support-help-title" className="text-xl font-bold">신청·결제 도움말</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {helpTopics.map((topic) => (
            <div key={topic.title} className="rounded-xl border border-border bg-card p-5">
              <h3 className="text-base font-semibold">{topic.title}</h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{topic.description}</p>
              {topic.href ? (
                <Link href={`${localePrefix}${topic.href}`} className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold underline underline-offset-4">
                  {topic.action}
                </Link>
              ) : (
                <SupportInquiryModal
                  triggerLabel={topic.action}
                  initialTitle={localePrefix ? "File upload problem" : topic.title}
                  initialBody={localePrefix ? "Application ID:\nFile name:\nStep and error message:\n" : "접수번호:\n파일명:\n문제가 발생한 단계와 오류 내용:\n"}
                  className="mt-3 inline-flex min-h-11 items-center gap-2 text-sm font-semibold underline underline-offset-4"
                />
              )}
            </div>
          ))}
        </div>
        <p className="mt-4 text-sm text-muted-foreground">문의 시 접수번호 또는 주문번호를 준비하면 내용을 확인하는 데 도움이 됩니다.</p>
      </section>

      <section className="mt-8 grid gap-4 sm:grid-cols-3">
        <a
          href={`tel:${APP_CONFIG.supportPhone}`}
          className="group flex min-h-36 flex-col items-center justify-center gap-3 rounded-[10px] border-2 border-[#111111] bg-[#f2cf27] p-5 text-center text-[#111111] shadow-[5px_5px_0_#111111] transition hover:-translate-y-1 dark:border-[#f2cf27] dark:shadow-[5px_5px_0_#f2cf27]"
        >
          <Phone className="h-8 w-8" aria-hidden="true" />
          <span className="text-base font-black">전화</span>
          <span className="text-xs font-semibold">{APP_CONFIG.supportPhone}</span>
        </a>
        <a
          href={`mailto:${APP_CONFIG.supportEmail}`}
          className="group flex min-h-36 flex-col items-center justify-center gap-3 rounded-[10px] border-2 border-[#111111] bg-[#1556a4] p-5 text-center text-white shadow-[5px_5px_0_#111111] transition hover:-translate-y-1 dark:border-[#f2cf27] dark:shadow-[5px_5px_0_#f2cf27]"
        >
          <Mail className="h-8 w-8" aria-hidden="true" />
          <span className="text-base font-black">이메일</span>
          <span className="max-w-full truncate text-xs font-semibold">
            {APP_CONFIG.supportEmail}
          </span>
        </a>
        <SupportInquiryModal
          className="flex min-h-36 w-full flex-col items-center justify-center gap-3 rounded-[10px] border-2 border-[#111111] bg-[var(--bauhaus-red)] p-5 text-center text-base font-black text-white shadow-[5px_5px_0_#111111] transition hover:-translate-y-1 dark:border-[#f2cf27] dark:text-[#06111f] dark:shadow-[5px_5px_0_#f2cf27]"
        />
      </section>

      <div className="mt-7 flex justify-center">
        <div className="inline-flex items-center gap-2 rounded-full border-2 border-border bg-card px-4 py-2 text-xs font-black text-muted-foreground">
          <Clock3 className="h-4 w-4" aria-hidden="true" />
          <span>{APP_CONFIG.supportHours}</span>
        </div>
      </div>
      <ArtmelonOnboarding />
    </div>
  );
}
