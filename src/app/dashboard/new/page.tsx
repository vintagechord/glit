import Link from "next/link";

export const metadata = {
  title: "새 심의 접수",
};

const submissionCards = [
  {
    eyebrow: "Album Review",
    title: "음반 심의",
    description: "트랙 정보 입력, 패키지 선택, 음원 업로드까지 한 흐름으로 진행합니다.",
    href: "/dashboard/new/album",
    tone: "border-black/8 bg-white text-[#1d1d1f] shadow-[0_24px_60px_rgba(0,0,0,0.08)] dark:border-white/10 dark:bg-[#1d1d1f] dark:text-white dark:shadow-none",
  },
  {
    eyebrow: "M/V Review",
    title: "M/V 심의",
    description: "TV 송출용과 온라인 업로드용 심의를 구분해 접수할 수 있습니다.",
    href: "/dashboard/new/mv",
    tone: "border-[#cfe3fb] bg-[#eaf3ff] text-[#1d1d1f] shadow-[0_24px_60px_rgba(0,113,227,0.12)] dark:border-[#1d4f7d] dark:bg-[#0b2a46] dark:text-white dark:shadow-none",
  },
  {
    eyebrow: "One Click",
    title: "원클릭 접수",
    description: "멜론 링크와 음원 파일만 제출하는 간편 음반 심의 접수입니다.",
    href: "/dashboard/new/album?mode=oneclick",
    tone: "border-transparent bg-[#0071e3] text-white shadow-[0_24px_60px_rgba(0,113,227,0.24)] dark:bg-[#2997ff] dark:text-[#00101f] dark:shadow-none",
  },
];

export default function NewSubmissionPage() {
  return (
    <div className="page-centered mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
      <section className="overflow-hidden rounded-[32px] border border-black/6 bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(245,245,247,0.98))] px-6 py-8 shadow-[0_30px_80px_rgba(0,0,0,0.08)] dark:border-white/10 dark:bg-[linear-gradient(180deg,rgba(29,29,31,0.94),rgba(0,0,0,0.98))] dark:shadow-none sm:px-8 sm:py-10">
        <p className="text-[11px] font-semibold uppercase tracking-[0.32em] text-muted-foreground">
          New Submission
        </p>
        <h1 className="font-display mt-3 text-3xl leading-tight text-foreground sm:text-4xl">
          접수 유형을 선택하세요
        </h1>
        <p className="mt-3 max-w-2xl text-sm text-muted-foreground sm:text-base">
          비회원도 바로 접수할 수 있고, 로그인 상태라면 내역이 마이페이지에 저장됩니다.
          접수 방식만 먼저 고르면 바로 다음 단계로 이어집니다.
        </p>

        <div className="mt-8 grid gap-5 md:grid-cols-3">
          {submissionCards.map((card) => (
            <Link
              key={card.href}
              href={card.href}
              className={`group rounded-[28px] border p-6 transition duration-200 hover:-translate-y-1 ${card.tone}`}
            >
              <p className="text-[11px] font-semibold uppercase tracking-[0.3em] opacity-65">
                {card.eyebrow}
              </p>
              <h2 className="mt-4 text-[28px] font-semibold tracking-[-0.03em]">
                {card.title}
              </h2>
              <p className="mt-3 text-sm leading-6 opacity-82">{card.description}</p>
              <div className="mt-6 inline-flex items-center gap-2 text-sm font-semibold">
                바로 시작
                <span className="transition-transform duration-200 group-hover:translate-x-1">
                  →
                </span>
              </div>
            </Link>
          ))}
        </div>
      </section>
      <div className="mt-5 px-1 text-sm text-muted-foreground">
        파일 업로드 단계에서 멈추는 경우, 초안 ID를 다시 준비하라는 안내가 나오면 바로 재시도 버튼을 눌러 진행할 수 있습니다.
      </div>
    </div>
  );
}
