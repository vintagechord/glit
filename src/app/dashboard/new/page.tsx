import { ChevronDown, Clapperboard, Disc3, Mail, Phone, Tv } from "lucide-react";

import { ReliableLink } from "@/components/site/reliable-link";
import { ALBUM_MULTI_DISCOUNT_BADGE } from "@/lib/album-payment-discount";
import { APP_CONFIG } from "@/lib/config";
import { reviewServices } from "@/lib/onside-content";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  title: "심의 신청 · 음반 심의·뮤직비디오 심의 온라인 접수",
  description: "음반 심의와 뮤직비디오 심의를 온라인으로 신청하세요. 방송국을 고르고 파일을 올린 뒤 카드 결제나 무통장 입금으로 접수합니다.",
  path: "/dashboard/new",
  enPath: "/en/dashboard/new",
});

const submissionCards = [
  {
    meta: "음원 · 라디오/TV",
    title: "음반 심의 접수",
    description: "발매 여부를 선택하면 알맞은 접수 방법으로 안내합니다.",
    badge: ALBUM_MULTI_DISCOUNT_BADGE,
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

// 2026-11-27 (owner): many applicants mix the reviews up, so the help under
// the cards goes by what they want to do with the song or the video. Each
// answer names the card above and follows the service definitions
// (onside-content.ts, review-guides.ts, review-glossary.ts).
const reviewChoices = [
  {
    situation: "새 노래를 라디오·TV에서 방송하고 싶어요",
    answer: "음원 방송 심의 (음반 심의)",
    detail: "방송국마다 가사와 음원을 심의합니다. 디지털 싱글 1곡도 같은 절차이고, 발매 전·후 모두 신청할 수 있어요.",
    href: "/dashboard/new/album",
    icon: Disc3,
    tone: "bg-[#f2cf27] text-[#111111]",
  },
  {
    situation: "이미 발매한 곡을 방송국에 내고 싶어요",
    answer: "음원 방송 심의 · 발매 후 접수",
    detail: "멜론이나 지니 앨범 링크로 추가금 없이 접수합니다. 심의용 음원 파일은 함께 올려주세요.",
    href: "/dashboard/new/album",
    icon: Disc3,
    tone: "bg-[#f2cf27] text-[#111111]",
  },
  {
    situation: "뮤직비디오를 유튜브·음원 사이트에 올리거나 유통사에 넘겨요",
    answer: "MV 온라인 유통용 심의",
    detail: "영상물등급위원회 등급분류를 받습니다. 결과와 함께 필증과 등급 표기 자료를 드려요.",
    href: "/dashboard/new/mv?type=distribution",
    icon: Clapperboard,
    tone: "bg-[#1556a4] text-white",
  },
  {
    situation: "뮤직비디오를 TV에서 방송하고 싶어요",
    answer: "MV 방송사 심의",
    detail: "KBS·MBC·SBS 가운데 방송사를 골라 방송사별로 받습니다. 방송사마다 영상 규격이 달라요.",
    href: "/dashboard/new/mv?type=broadcast",
    icon: Tv,
    tone: "bg-[#d9362c] text-white",
  },
] as const;

const reviewChoiceNotes = [
  "음원 심의·앨범 심의·방송국 심의·라디오 심의는 모두 같은 음반 심의예요. 「음원 방송 심의」로 신청하면 됩니다.",
  "뮤직비디오 심의는 노래의 음반 심의와 따로 받는 절차예요.",
  "온사이드 음반 심의에서 적격을 받은 곡은 결과 화면의 「라디오 신청 가이드」에서 라디오 신청 방법까지 볼 수 있어요.",
] as const;

export default function NewSubmissionPage() {
  return (
    <div className="page-centered mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
      <section className="relative overflow-hidden rounded-[10px] border-2 border-[#111111] bg-card px-4 py-6 shadow-[8px_8px_0_#111111] dark:border-[#f2cf27] dark:shadow-[8px_8px_0_#f2cf27] sm:px-8 sm:py-10">
        <div className="flex flex-wrap items-center gap-2">
          <p className="bauhaus-kicker">심의 신청</p>
          <span className="rounded-full border border-border bg-background px-3 py-1 text-xs font-black text-foreground">
            비회원 가능
          </span>
        </div>
        <h1 className="font-display mt-4 break-keep text-balance text-2xl font-black leading-tight text-foreground sm:text-4xl">
          무엇을 신청하시나요?
        </h1>
        <div className="mt-6 grid gap-4 lg:grid-cols-3 sm:mt-8 sm:gap-5">
          {submissionCards.map((card, index) => (
            <ReliableLink
              key={card.href}
              href={card.href}
              // Phones: compact row with the button on the right; larger screens keep the tall card.
              className={`group relative flex min-w-0 items-center gap-3 rounded-[10px] border-2 p-4 transition duration-200 hover:-translate-y-1 hover:shadow-[9px_9px_0_#111111] sm:flex-col sm:items-stretch sm:gap-0 sm:p-6 ${card.tone}`}
            >
              {"badge" in card && card.badge ? (
                // Pinned to the corner so the card keeps the height of its neighbours.
                <span className="absolute -top-2.5 right-3 z-10 rounded-[6px] border-2 border-[#111111] bg-[#d9362c] px-2 py-1 text-[11px] font-black leading-none text-white shadow-[2px_2px_0_#111111] sm:right-5 sm:top-5 sm:px-2.5 sm:py-1.5 sm:text-xs">
                  {card.badge}
                </span>
              ) : null}
              <div className="min-w-0 flex-1 sm:flex sm:flex-col">
                <div className="flex items-center gap-2 sm:block">
                  <card.icon className="h-5 w-5 shrink-0 sm:h-7 sm:w-7" aria-hidden="true" />
                  <p className="text-xs font-black tracking-normal sm:mt-3 sm:text-sm">
                    {card.meta}
                  </p>
                </div>
                <h2 className="mt-1.5 break-keep text-balance text-lg font-black leading-snug tracking-normal sm:mt-4 sm:text-[28px]">
                  {reviewServices[index].title}
                </h2>
                <p className="mt-1 text-xs font-semibold leading-5 sm:mt-3 sm:mb-6 sm:text-sm sm:leading-6">{reviewServices[index].purpose}</p>
              </div>
              <div className="inline-flex w-fit shrink-0 items-center gap-1.5 whitespace-nowrap border-2 border-current bg-white px-3 py-2 text-xs font-black text-[#111111] sm:mt-auto sm:gap-2 sm:px-4 sm:text-sm">
                신청하기
                <span className="transition-transform duration-200 group-hover:translate-x-1">
                  →
                </span>
              </div>
            </ReliableLink>
          ))}
        </div>
        <details className="group mt-6 rounded-[10px] border-2 border-[#111111] bg-background dark:border-[#f2cf27]/70">
          <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 rounded-[8px] px-4 py-3 text-base font-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1556a4] focus-visible:ring-offset-2 dark:focus-visible:ring-[#f2cf27] [&::-webkit-details-marker]:hidden">
            어떤 심의가 필요한지 모르겠어요
            <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-[7px] border-2 border-[#111111] bg-card transition-transform group-open:rotate-180 dark:border-[#f2cf27]">
              <ChevronDown className="h-4 w-4" />
            </span>
          </summary>
          <div className="px-4 pb-5">
            <p className="break-keep text-sm font-semibold leading-6 text-muted-foreground">내 음악을 어디에 내보낼지로 고르면 됩니다.</p>
            <ul className="mt-3 grid gap-3 md:grid-cols-2">
              {reviewChoices.map((choice) => (
                <li key={choice.situation} className="flex flex-col rounded-[8px] border-2 border-[#111111] bg-card p-4 dark:border-[#f2cf27]/60">
                  <p className="break-keep text-[15px] font-black leading-6 text-foreground">{choice.situation}</p>
                  <p className="mt-2 flex items-center gap-2">
                    <span className={`flex size-7 shrink-0 items-center justify-center rounded-[6px] border-2 border-[#111111] ${choice.tone}`}>
                      <choice.icon className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <span className="break-keep text-sm font-black text-foreground">{choice.answer}</span>
                  </p>
                  <p className="mt-2 break-keep text-sm leading-6 text-foreground/80">{choice.detail}</p>
                  <ReliableLink href={choice.href} className="mt-3 w-fit text-sm font-black text-foreground underline decoration-[#f2cf27] decoration-[3px] underline-offset-4 transition hover:decoration-[#111111] dark:hover:decoration-[#f2cf27]">
                    이 심의 신청하기 →
                  </ReliableLink>
                </li>
              ))}
            </ul>
            <ul className="mt-4 space-y-2">
              {reviewChoiceNotes.map((note) => (
                <li key={note} className="flex gap-2 break-keep text-sm leading-6 text-foreground/85">
                  <span aria-hidden="true" className="mt-2 size-2 shrink-0 bg-[#f2cf27] ring-1 ring-[#111111]" />
                  {note}
                </li>
              ))}
            </ul>
            <div className="mt-5 rounded-[8px] border-2 border-[#111111] bg-card p-4 dark:border-[#f2cf27]/60">
              <p className="break-keep text-base font-black text-foreground">그래도 헷갈리면 전화나 메일로 물어보세요</p>
              <p className="mt-1 break-keep text-sm leading-6 text-foreground/80">공개할 곳과 제출처(방송사·유통사)를 알려주시면 맞는 심의를 골라 드려요.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <a href={`tel:${APP_CONFIG.supportPhone}`} className="inline-flex min-h-11 items-center gap-2 rounded-[8px] border-2 border-[#111111] bg-background px-3 text-sm font-black text-foreground transition hover:bg-[#f2cf27] hover:text-[#111111] dark:border-[#f2cf27]">
                  <Phone className="h-4 w-4" aria-hidden="true" />
                  <span data-no-translate>{APP_CONFIG.supportPhone}</span>
                </a>
                <a href={`mailto:${APP_CONFIG.supportEmail}`} className="inline-flex min-h-11 items-center gap-2 break-all rounded-[8px] border-2 border-[#111111] bg-background px-3 text-sm font-black text-foreground transition hover:bg-[#f2cf27] hover:text-[#111111] dark:border-[#f2cf27]">
                  <Mail className="h-4 w-4" aria-hidden="true" />
                  <span data-no-translate>{APP_CONFIG.supportEmail}</span>
                </a>
              </div>
              <p className="mt-2 text-xs font-semibold text-muted-foreground">{`상담시간 ${APP_CONFIG.supportHours}`}</p>
            </div>
          </div>
        </details>
      </section>
      <div className="mt-4 text-right text-xs font-semibold text-muted-foreground">
        <ReliableLink
          href="https://onside17.com/"
          target="_blank"
          rel="noopener noreferrer"
          className="underline-offset-4 transition hover:text-foreground hover:underline"
        >
          Legacy 사이트 접수
        </ReliableLink>
      </div>
    </div>
  );
}
