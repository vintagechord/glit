"use client";

import { useEffect, useId, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Archive, Check, Disc3, Package, Plus, Radio, X } from "lucide-react";

// 2026-11-27 (owner): "방송 신청 방법 제공" was easy to miss, and it did not
// say the guide is for songs whose review is done. The radio card now spans
// the box with a title that says so; the other two sit in a row under it.
const services = [
  { key: "broadcast", icon: Radio, color: "bg-[#1556a4] text-white", ko: "심의 완료 곡, 라디오 신청 방법까지", en: "Radio guide for reviewed songs" },
  { key: "archive", icon: Archive, color: "bg-[#f2cf27] text-[#111111]", ko: "심의 기록 보관", en: "Review archive" },
  { key: "artmelon", icon: Disc3, color: "bg-[#d9362c] text-white", ko: "아트멜론 입점", en: "Artmelon store" },
] as const;
type Service = (typeof services)[number];

const serviceFocusClass =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1556a4] focus-visible:ring-offset-2 dark:focus-visible:ring-[#f2cf27] dark:focus-visible:ring-offset-[#171717]";

export function HomeHeroAdBanner() {
  const isEnglish = usePathname().startsWith("/en");
  const [active, setActive] = useState<{ service: Service; trigger: HTMLButtonElement } | null>(null);
  const radioNoteId = useId();
  const [radio, ...others] = services;
  const RadioIcon = radio.icon;

  return (
    <>
      <section
        data-no-translate
        aria-label={isEnglish ? "Your next steps with Onside" : "온사이드와 함께하는 심의 그 다음"}
        className="w-full max-w-[540px] rounded-[10px] border-[1.5px] border-[#111111] bg-white p-3 dark:border-[#f2cf27] dark:bg-[#171717]"
      >
        <div className="mb-2">
          <p className="text-xs font-black text-foreground sm:text-[13px]">
            {isEnglish ? "Beyond review, with Onside" : "심의 그 다음까지, 온사이드"}
          </p>
        </div>
        <button
          type="button"
          aria-haspopup="dialog"
          aria-label={isEnglish ? radio.en : radio.ko}
          aria-describedby={radioNoteId}
          onClick={event => {
            setActive({ service: radio, trigger: event.currentTarget });
          }}
          className={`group relative flex min-h-14 w-full min-w-0 items-center gap-3 rounded-[7px] border-[1.5px] border-[#111111] bg-[#fffaf0] py-2 pl-2.5 pr-7 text-left transition hover:-translate-y-0.5 hover:shadow-[2px_2px_0_#111111] dark:border-[#f2cf27] dark:bg-white/5 dark:hover:shadow-[2px_2px_0_#f2cf27] ${serviceFocusClass}`}
        >
          <span className={`flex size-9 shrink-0 items-center justify-center rounded-md border-[1.5px] border-[#111111] ${radio.color}`}>
            <RadioIcon className="size-[18px]" aria-hidden="true" />
          </span>
          <span className="min-w-0">
            <span className="block break-keep text-[13px] font-black leading-5 text-foreground sm:text-sm">
              {isEnglish ? radio.en : radio.ko}
            </span>
            <span id={radioNoteId} className="mt-0.5 block break-keep text-[11px] font-semibold leading-4 text-muted-foreground">
              {isEnglish ? "Only for Onside-reviewed songs · Steps" : "온사이드 심의를 마친 곡만 · 단계별 보기"}
            </span>
          </span>
          <Plus className="absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[#111111] transition group-hover:rotate-90 dark:text-[#f2cf27]" aria-hidden="true" />
        </button>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {others.map(service => {
            const Icon = service.icon;
            return (
              <button
                key={service.key}
                type="button"
                aria-haspopup="dialog"
                onClick={event => {
                  setActive({ service, trigger: event.currentTarget });
                }}
                className={`group relative flex min-h-11 min-w-0 items-center gap-2 rounded-[7px] border border-[#111111]/15 bg-[#fffaf0] py-1.5 pl-2 pr-6 text-left transition hover:-translate-y-0.5 hover:border-[#111111] hover:shadow-[2px_2px_0_#111111] dark:border-white/20 dark:bg-white/5 dark:hover:border-[#f2cf27] ${serviceFocusClass}`}
              >
                <span className={`flex size-7 shrink-0 items-center justify-center rounded-md ${service.color}`}>
                  <Icon className="size-4" aria-hidden="true" />
                </span>
                <span className="min-w-0 break-keep text-[11px] font-bold leading-4 text-foreground sm:text-xs">
                  {isEnglish ? service.en : service.ko}
                </span>
                <Plus className="absolute right-2 top-1/2 size-2.5 -translate-y-1/2 text-muted-foreground transition group-hover:text-foreground" aria-hidden="true" />
              </button>
            );
          })}
        </div>
      </section>
      {active && (
        <ServicePreview
          service={active.service}
          isEnglish={isEnglish}
          returnFocusTarget={active.trigger}
          onClose={() => setActive(null)}
        />
      )}
    </>
  );
}

function ServicePreview({ service, isEnglish, returnFocusTarget, onClose }: {
  service: Service;
  isEnglish: boolean;
  returnFocusTarget: HTMLButtonElement | null;
  onClose: () => void;
}) {
  const id = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const Icon = service.icon;
  // Owner 2026-11-16: one plain sentence saying what the service is, then
  // the example, then a single note. Earlier copy read as too much text.
  // 2026-11-27 (owner): the radio guide is shown as the steps it really takes
  // (radio-request-wizard.tsx: 내 곡 확인 → 프로그램 → 신청글 작성 → 신청·확인),
  // and it says the guide is only for songs whose review is done.
  const descriptions = {
    broadcast: isEnglish
      ? "Once your song has passed an Onside review, we walk you through requesting it on the radio, step by step."
      : "온사이드에서 심의를 마친 곡이라면, 내 음악을 라디오에 신청하는 방법을 단계별로 알려드립니다.",
    archive: isEnglish
      ? "Keep every review and release in one place, including reviews you got elsewhere."
      : "다른 곳에서 받은 심의와 발매 정보까지 한곳에 저장하고 관리합니다.",
    artmelon: isEnglish
      ? "Onside review members get an easier start on Artmelon, the store for CDs, LPs and merch."
      : "온사이드 심의 회원은 CD·LP·굿즈 판매처 아트멜론에 더 수월하게 입점합니다.",
  };
  const notes = {
    broadcast: isEnglish
      ? "Only for songs approved in an Onside album review: open Radio request guide on your result page."
      : "온사이드 음반 심의에서 적격을 받은 곡에 한해, 심의 결과 화면의 「라디오 신청 가이드」에서 이용합니다.",
    archive: isEnglish ? "Find it under My Music in your account." : "회원 계정의 내 음악 관리에서 이용합니다.",
    artmelon: isEnglish ? "Store and selling terms are set in a consultation." : "입점·판매 조건은 상담으로 안내합니다.",
  };

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const { body, documentElement } = document;
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;
    const previousBody = {
      overflow: body.style.overflow, position: body.style.position,
      top: body.style.top, left: body.style.left, width: body.style.width,
    };
    const previousRootOverflow = documentElement.style.overflow;
    Object.assign(body.style, {
      overflow: "hidden", position: "fixed", top: `-${scrollY}px`,
      left: `-${scrollX}px`, width: "100%",
    });
    documentElement.style.overflow = "hidden";
    dialog.showModal();
    closeRef.current?.focus({ preventScroll: true });
    return () => {
      dialog.close();
      Object.assign(body.style, previousBody);
      documentElement.style.overflow = previousRootOverflow;
      window.scrollTo(scrollX, scrollY);
      if (returnFocusTarget?.isConnected) returnFocusTarget.focus({ preventScroll: true });
    };
  }, [returnFocusTarget]);

  return (
    <dialog
      ref={dialogRef}
      data-no-translate
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-description`}
      aria-modal="true"
      onCancel={event => { event.preventDefault(); onClose(); }}
      onClick={event => { if (event.target === event.currentTarget) onClose(); }}
      onKeyDown={event => {
        // The close button is the preview's only interactive control.
        if (event.key === "Tab") {
          event.preventDefault();
          closeRef.current?.focus();
        }
      }}
      className="fixed inset-0 m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg overflow-y-auto overscroll-contain rounded-xl border-2 border-[#111111] bg-[#fffaf0] p-0 text-foreground shadow-[5px_5px_0_#111111] backdrop:bg-black/50 backdrop:backdrop-blur-sm dark:border-[#f2cf27] dark:bg-[#171717] dark:shadow-[5px_5px_0_#f2cf27]"
    >
      <div className="p-5 sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id={`${id}-title`} className="flex items-center gap-2.5 break-keep text-lg font-black sm:text-xl">
              <span className={`flex size-8 shrink-0 items-center justify-center rounded-md ${service.color}`}>
                <Icon className="size-4" aria-hidden="true" />
              </span>
              {isEnglish ? service.en : service.ko}
            </h2>
          </div>
          <button
            ref={closeRef}
            type="button"
            aria-label={isEnglish ? "Close service preview" : "서비스 예시 닫기"}
            onClick={onClose}
            className="-mr-2 -mt-2 flex size-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-black/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1556a4] dark:hover:bg-white/10 dark:focus-visible:ring-[#f2cf27]"
          >
            <X className="size-5" aria-hidden="true" />
          </button>
        </div>
        <p id={`${id}-description`} className="mt-4 break-keep text-sm leading-6 text-muted-foreground">
          {descriptions[service.key]}
        </p>
        <div className="mt-5 overflow-hidden rounded-lg border border-[#111111]/15 bg-white dark:border-white/15 dark:bg-[#222222]">
          <div className="border-b border-[#111111]/10 px-4 py-2 text-[10px] font-bold tracking-wide text-muted-foreground dark:border-white/10">
            {isEnglish ? "ILLUSTRATIVE EXAMPLE · FICTIONAL DATA" : "이해를 돕기 위한 가상의 예시입니다"}
          </div>
          {service.key === "broadcast" ? <BroadcastExample isEnglish={isEnglish} /> : null}
          {service.key === "archive" ? <ArchiveExample isEnglish={isEnglish} /> : null}
          {service.key === "artmelon" ? <ArtmelonExample isEnglish={isEnglish} /> : null}
        </div>
        <p className="mt-4 break-keep text-xs leading-5 text-muted-foreground">{notes[service.key]}</p>
      </div>
    </dialog>
  );
}

/**
 * The radio guide as the four steps a reviewed song goes through, each with
 * a small picture of what the visitor sees there. The numbers sit in the
 * yellow square of the logo, joined by an ink line.
 */
function BroadcastExample({ isEnglish }: { isEnglish: boolean }) {
  const chip = "inline-flex items-center gap-1 rounded-[5px] border border-[#111111]/40 bg-[#fffaf0] px-2 py-1 text-[11px] font-bold dark:border-white/30 dark:bg-white/5";
  const steps = [
    {
      title: isEnglish ? "Review complete" : "심의 완료",
      body: isEnglish ? "Your song, approved by the broadcaster" : "방송국에서 적격을 받은 내 곡",
      picture: (
        <span className="mt-2 flex items-center gap-2">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-[5px] bg-[#1556a4] text-white"><Disc3 className="size-4" aria-hidden="true" /></span>
          <span className="min-w-0 truncate text-xs font-bold">{isEnglish ? "Fragments of Dawn" : "새벽의 조각"}</span>
          <span className="shrink-0 rounded border-2 border-[#111111] bg-[#1556a4] px-1.5 py-0.5 text-[10px] font-black text-white dark:border-[#f2cf27]">{isEnglish ? "Eligible" : "방송 적격"}</span>
        </span>
      ),
    },
    {
      title: isEnglish ? "Pick a program" : "프로그램 고르기",
      body: isEnglish ? "Program info and recent playlists show where your song fits" : "프로그램 소개와 최근 선곡표로 내 곡에 맞는 곳 찾기",
      picture: (
        <span className="mt-2 flex flex-wrap gap-1.5">
          <span className={`${chip} border-[#111111] underline decoration-[#f2cf27] decoration-2 underline-offset-4 dark:border-[#f2cf27]`}>
            <span className="flex size-3.5 items-center justify-center rounded-[3px] bg-[#f2cf27] text-[#111111]"><Check className="size-2.5" strokeWidth={3.5} aria-hidden="true" /></span>
            {isEnglish ? "Morning music show" : "아침 음악 프로그램"}
          </span>
          <span className={chip}>{isEnglish ? "Late-night radio" : "심야 음악 프로그램"}</span>
        </span>
      ),
    },
    {
      title: isEnglish ? "Write your request" : "신청글 쓰기",
      body: isEnglish ? "Help writing a request that tells your song's story" : "곡의 이야기를 담은 신청글 작성 도움",
      picture: (
        <span className="mt-2 flex flex-wrap gap-1.5">
          {(isEnglish ? ["Inspiration", "Listening moment", "Song mood"] : ["만든 이야기", "듣기 좋은 순간", "곡의 분위기"]).map(prompt => (
            <span key={prompt} className={chip}>{prompt}</span>
          ))}
        </span>
      ),
    },
    {
      title: isEnglish ? "Post on the official board" : "공식 게시판에 신청",
      body: isEnglish ? "A direct link to the broadcaster's own request board" : "방송국 공식 신청 게시판으로 바로 연결",
      picture: null,
    },
  ];
  return (
    <ol className="space-y-3 p-4" aria-label={isEnglish ? "Radio request steps" : "라디오 신청 단계"}>
      {steps.map((step, index) => (
        <li key={step.title} className="relative flex gap-3">
          {index < steps.length - 1 ? (
            <span aria-hidden="true" className="absolute -bottom-3 left-[13px] top-7 w-0.5 bg-[#111111] dark:bg-[#f2cf27]" />
          ) : null}
          <span className="relative z-10 flex size-7 shrink-0 items-center justify-center rounded-[5px] border-2 border-[#111111] bg-[#f2cf27] text-xs font-black text-[#111111]">
            {index + 1}
          </span>
          <span className="min-w-0 flex-1 pt-0.5">
            <span className="block text-sm font-black">{step.title}</span>
            <span className="mt-0.5 block break-keep text-xs leading-5 text-muted-foreground">{step.body}</span>
            {step.picture}
          </span>
        </li>
      ))}
    </ol>
  );
}

function ArchiveExample({ isEnglish }: { isEnglish: boolean }) {
  const albums = isEnglish
    ? [{ title: "Fragments of Dawn", type: "Single · 2026.10", status: "Onside review", detail: "Saved automatically", complete: true },
      { title: "Blue Afternoon", type: "EP · 2026.09", status: "Reviewed elsewhere", detail: "Added by you", complete: false }]
    : [{ title: "새벽의 조각", type: "싱글 · 2026.10", status: "온사이드 심의", detail: "자동 저장", complete: true },
      { title: "파란 오후", type: "EP · 2026.09", status: "외부 심의", detail: "직접 등록", complete: false }];
  return (
    <div className="divide-y divide-[#111111]/10 dark:divide-white/10">
      {albums.map(album => (
        <div key={album.title} className="flex items-center gap-3 p-4">
          <div className={`flex size-11 shrink-0 items-center justify-center rounded-md ${album.complete ? "bg-[#f2cf27]" : "bg-[#1556a4]"}`}>
            <Disc3 className={`size-6 ${album.complete ? "text-[#111111]" : "text-white"}`} aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold">{album.title}</p>
            <p className="mt-1 text-[10px] text-muted-foreground">{album.type}</p>
          </div>
          <div className="shrink-0 text-right">
            <span className="text-xs font-bold">{album.status}</span>
            <p className="mt-1 text-[10px] text-muted-foreground">{album.detail}</p>
          </div>
        </div>
      ))}
      <p className="flex items-center gap-2 px-4 py-3 text-xs text-muted-foreground"><Archive className="size-3.5 shrink-0" aria-hidden="true" />{isEnglish ? "Every review and release, in one account" : "심의·발매 기록을 한 계정에"}</p>
    </div>
  );
}

function ArtmelonExample({ isEnglish }: { isEnglish: boolean }) {
  return (
    <div className="p-4">
      <p className="text-[10px] font-black tracking-widest text-[#d9362c] dark:text-red-400">ONSIDE × ARTMELON</p>
      <div className="my-4 grid grid-cols-3 gap-2">
        {[
          { name: "CD", icon: Disc3, color: "text-[#d9362c] dark:text-[#ff6258]" },
          { name: "LP", icon: Disc3, color: "text-[#1556a4] dark:text-[#3f8ad8]" },
          { name: isEnglish ? "Merch" : "굿즈", icon: Package, color: "text-[#1f7a5a] dark:text-[#46b783]" },
        ].map(({ name, icon: Icon, color }) => (
          <div key={name} className="flex flex-col items-center gap-2 rounded-md border-2 border-[#111111] bg-background py-4 dark:border-[#f2cf27]">
            <Icon className={`${name === "LP" ? "size-9" : "m-1 size-7"} ${color}`} aria-hidden="true" />
            <span className="text-xs font-bold">{name}</span>
          </div>
        ))}
      </div>
      <ol className="space-y-2.5">
        {(isEnglish ? ["Review history check", "Products and quantities", "Onboarding consultation"] : ["심의 이력 확인", "판매 상품·수량 전달", "입점 상담 연결"]).map(step => (
          <li key={step} className="flex items-center gap-2 text-xs"><Check className="size-3.5 shrink-0 text-[#d9362c] dark:text-red-400" aria-hidden="true" />{step}</li>
        ))}
      </ol>
    </div>
  );
}
