import { ReliableLink } from "@/components/site/reliable-link";
import { APP_CONFIG } from "@/lib/config";

export const metadata = {
  title: "새 심의 접수",
};

const submissionCards = [
  {
    eyebrow: "방송국별 음반 심의",
    title: "음반 심의",
    description: "TV·라디오 송출용 음원 심의입니다.",
    href: "/dashboard/new/album",
    tone: "border-[#111111] bg-[#f2cf27] text-[#111111] shadow-[6px_6px_0_#111111] dark:border-[#f2cf27] dark:bg-[#f2cf27] dark:text-[#111111] dark:shadow-[6px_6px_0_#f2cf27]",
  },
  {
    eyebrow: "뮤직비디오 심의",
    title: "뮤직비디오 온라인 심의",
    description: "유통사 제출과 온라인 업로드용입니다.",
    href: "/dashboard/new/mv",
    tone: "border-[#111111] bg-[#1556a4] text-white shadow-[6px_6px_0_#111111] dark:border-[#f2cf27] dark:bg-[#3f8ad8] dark:text-[#06111f] dark:shadow-[6px_6px_0_#f2cf27]",
  },
  {
    eyebrow: "TV 송출 목적",
    title: "뮤직비디오 TV 송출 심의",
    description: "방송국별 조건을 확인한 뒤 접수합니다.",
    href: "/dashboard/new/mv?type=broadcast",
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
        <ul className="mt-4 space-y-2 text-sm font-semibold text-muted-foreground sm:text-base">
          <li>비회원도 접수할 수 있습니다.</li>
          <li>로그인하면 접수 내역이 마이페이지에 저장됩니다.</li>
        </ul>

        <div className="mt-8 grid gap-5 md:grid-cols-3">
          {submissionCards.map((card) => (
            <ReliableLink
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
            </ReliableLink>
          ))}
        </div>
      </section>
      <div className="mt-5 rounded-[10px] border-2 border-[#111111] bg-white px-5 py-4 text-sm font-semibold text-muted-foreground shadow-[5px_5px_0_#111111] dark:border-[#f2cf27] dark:bg-[#171717] dark:shadow-[5px_5px_0_#f2cf27]">
        이전 버전의 온사이드 사이트가 편하신 경우 이전 사이트에서 접수해주셔도 심의는 동일하게 진행이 됩니다.
        <p className="mt-2 font-semibold text-foreground">{APP_CONFIG.supportEmail}</p>
        <ReliableLink
          href="https://onside17.com/"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-flex rounded-[8px] border-2 border-[#111111] bg-[#f2cf27] px-4 py-2 text-xs font-black text-[#111111] shadow-[3px_3px_0_#111111] transition hover:-translate-y-0.5"
        >
          예전 온사이드 주소 바로가기
        </ReliableLink>
      </div>
    </div>
  );
}
