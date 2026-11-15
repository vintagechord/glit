"use client";

import { useEffect, useId, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Archive, Check, Disc3, Package, Plus, Radio, X } from "lucide-react";

const services = [
  { key: "broadcast", icon: Radio, color: "bg-[#1556a4] text-white", ko: "방송 신청 방법 제공", en: "Broadcast request instructions" },
  { key: "archive", icon: Archive, color: "bg-[#f2cf27] text-[#111111]", ko: "심의 기록 보관", en: "Review archive" },
  { key: "artmelon", icon: Disc3, color: "bg-[#d9362c] text-white", ko: "아트멜론 입점", en: "Artmelon store" },
] as const;
type Service = (typeof services)[number];

export function HomeHeroAdBanner() {
  const isEnglish = usePathname().startsWith("/en");
  const [active, setActive] = useState<{ service: Service; trigger: HTMLButtonElement } | null>(null);

  return (
    <>
      <section
        data-no-translate
        aria-label={isEnglish ? "Your next steps with Onside" : "온사이드와 함께하는 심의 그 다음"}
        className="w-full max-w-[540px] rounded-[10px] border-[1.5px] border-[#111111] bg-white p-3 dark:border-[#f2cf27] dark:bg-[#171717]"
      >
        <div className="mb-2.5">
          <p className="text-xs font-black text-foreground sm:text-[13px]">
            {isEnglish ? "Beyond review, with Onside" : "심의 그 다음까지, 온사이드"}
          </p>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {services.map(service => {
            const Icon = service.icon;
            return (
              <button
                key={service.key}
                type="button"
                aria-haspopup="dialog"
                onClick={event => {
                  setActive({ service, trigger: event.currentTarget });
                }}
                className="group relative flex min-h-20 min-w-0 flex-col items-center justify-center gap-2 rounded-[7px] border border-[#111111]/15 bg-[#fffaf0] px-1 py-2 text-center transition hover:-translate-y-0.5 hover:border-[#111111] hover:shadow-[2px_2px_0_#111111] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1556a4] focus-visible:ring-offset-2 dark:border-white/20 dark:bg-white/5 dark:hover:border-[#f2cf27] dark:focus-visible:ring-[#f2cf27] dark:focus-visible:ring-offset-[#171717]"
              >
                <span className={`flex size-7 items-center justify-center rounded-md ${service.color}`}>
                  <Icon className="size-4" aria-hidden="true" />
                </span>
                <span className="break-keep text-[11px] font-bold leading-4 text-foreground sm:text-xs">
                  {isEnglish ? service.en : service.ko}
                </span>
                <Plus className="absolute right-1.5 top-1.5 size-2.5 text-muted-foreground transition group-hover:text-foreground" aria-hidden="true" />
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
  const descriptions = {
    broadcast: isEnglish
      ? "We find radio programs that fit your song and give you the links to their request boards."
      : "내 음악에 맞는 라디오 프로그램과 신청 게시판 링크를 알려드립니다.",
    archive: isEnglish
      ? "Keep every review and release in one place, including reviews you got elsewhere."
      : "다른 곳에서 받은 심의와 발매 정보까지 한곳에 저장하고 관리합니다.",
    artmelon: isEnglish
      ? "Onside review members get an easier start on Artmelon, the store for CDs, LPs and merch."
      : "온사이드 심의 회원은 CD·LP·굿즈 판매처 아트멜론에 더 수월하게 입점합니다.",
  };
  const notes = {
    broadcast: isEnglish ? "For members with a completed Onside review." : "심의를 완료한 회원에게 제공됩니다.",
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
            <h2 id={`${id}-title`} className="flex items-center gap-2.5 text-lg font-black sm:text-xl">
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

function BroadcastExample({ isEnglish }: { isEnglish: boolean }) {
  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center gap-3">
        <div className="flex size-12 shrink-0 items-center justify-center rounded-md bg-[#1556a4] text-white"><Disc3 className="size-7" aria-hidden="true" /></div>
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">{isEnglish ? "Your reviewed track" : "방송 신청할 내 곡"}</p>
          <p className="mt-1 text-sm font-bold">{isEnglish ? "Fragments of Dawn" : "새벽의 조각"}</p>
        </div>
        <span className="ml-auto shrink-0 rounded border-2 border-[#111111] bg-[#1556a4] px-2 py-1 text-[10px] font-black text-white dark:border-[#f2cf27]">{isEnglish ? "Eligible" : "방송 적격"}</span>
      </div>
      <ol className="grid grid-cols-3 gap-1.5">
        {(isEnglish ? ["Program picks", "Request board links", "How to request"] : ["프로그램 추천", "게시판 링크", "신청 방법"]).map((step, index) => (
          <li key={step} className="rounded border border-[#111111]/15 bg-[#fffaf0] px-2 py-2 text-xs dark:border-white/20 dark:bg-white/5">
            <span className="mb-1 block text-[10px] font-black text-[#1556a4] dark:text-[#f2cf27]">0{index + 1}</span>{step}
          </li>
        ))}
      </ol>
      <div className="rounded-md border-l-4 border-[#1556a4] bg-[#fffaf0] p-3 dark:bg-white/5">
        <p className="text-[10px] font-bold text-muted-foreground">{isEnglish ? "Example pick" : "추천 예시"}</p>
        <p className="mt-1.5 break-keep text-xs leading-5">
          {isEnglish ? "A morning music show · listener board" : "아침 음악 프로그램 · 청취자 게시판"}
        </p>
      </div>
    </div>
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
