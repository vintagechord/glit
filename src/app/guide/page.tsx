import Link from "next/link";

export const metadata = {
  title: "심의 안내",
};

const albumSteps = [
  {
    number: "01",
    title: "음반심의란?",
    description:
      "TV/라디오에 음악이 송출되려면 각 방송국 심의를 통과해야 합니다. 가사 내 욕설·비속어·상품 노출 등의 요소를 확인하는 절차를 통칭해 음반심의라고 합니다.",
  },
  {
    number: "02",
    title: "방송국 심의 현황",
    description:
      "심의를 받은 음반은 MBC, SBS, KBS, TBC, TBN 등의 채널을 통해 전국 79개 지역 방송국에 전달됩니다.",
    bullets: [
      "심의기간: 접수 후 하루 ~ 최대 3주 (방송국별 상이)",
      "발매 전/후 모두 접수 가능",
      "현재 다수 방송국은 직접 방문 접수가 기준",
    ],
  },
  {
    number: "03",
    title: "온사이드의 심의 대행",
    description: "온사이드 플랫폼에서 쉽고 빠른 접수",
    bullets: [
      "온라인/카드 결제 지원",
      "온라인 제출로 간편 접수",
      "디지털 음반의 경우 심의용 CD·가사집 무료 제작",
      "진행 상황과 결과를 한눈에 보는 개별 페이지",
    ],
  },
];

const mvSteps = [
  {
    number: "01",
    title: "뮤직비디오 심의란?",
    description:
      "뮤직비디오의 송출/유통 목적에 맞는 심의 절차를 거칩니다. 폭력성·선정성·광고 노출 등 영상 요소를 확인합니다.",
  },
  {
    number: "02",
    title: "방송국 및 영등위 심의 현황",
    description:
      "TV 송출 목적은 방송국별 개별 심의가 필요하고, 유통/온라인 목적은 한 곳 심의로 유통 제출이 가능합니다.",
    bullets: [
      "심의 목적: ① TV 방송 송출 ② 유통사 제출/온라인 업로드",
      "권장 포맷: MOV · 1920×1080 · 29.97fps",
      "심의 완료 후 등급분류 파일을 결과 페이지에서 다운로드",
    ],
  },
  {
    number: "03",
    title: "온사이드의 뮤비 심의 대행",
    description: "뮤직비디오 접수를 방송 가능 상태까지 빠르고 정확하게 진행합니다.",
    bullets: [
      "온라인 신청서 작성과 파일 업로드 동시 지원",
      "관리자 2차 확인으로 방송국 접수 누락 최소화",
      "진행 상황과 결과를 한눈에 보는 개별 페이지 제공",
    ],
  },
];

export default function GuidePage() {
  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-12">
      <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
        Review Guide
      </p>
      <h1 className="font-display mt-2 text-3xl text-foreground">심의 안내</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        음반과 뮤직비디오 심의 진행 방식과 준비사항을 한눈에 정리했습니다.
      </p>

      <section className="mt-10 rounded-[32px] border border-border/60 bg-card/80 p-8 shadow-[0_22px_70px_rgba(15,23,42,0.1)]">
        <h2 className="font-display mt-4 text-2xl text-foreground">
          음반심의, 이렇게 진행됩니다
        </h2>

        <div className="mt-6 grid gap-4 lg:grid-cols-3">
          {albumSteps.map((step) => (
            <div
              key={step.number}
              className="rounded-2xl border border-border/60 bg-background/70 p-5"
            >
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-foreground text-xs font-semibold uppercase tracking-[0.2em] text-background">
                  {step.number}
                </span>
                <div>
                  <p className="text-sm font-semibold text-foreground">
                    {step.title}
                  </p>
                  {step.description === "음원과 신청서만 보내주세요" && (
                    <p className="text-xs text-muted-foreground">
                      {step.description}
                    </p>
                  )}
                </div>
              </div>
              {step.description !== "음원과 신청서만 보내주세요" && (
                <p className="mt-3 text-sm text-muted-foreground">
                  {step.description}
                </p>
              )}
              {step.bullets && (
                <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
                  {step.bullets.map((bullet) => (
                    <li key={bullet} className="flex gap-2">
                      <span className="mt-1 h-1.5 w-1.5 rounded-full bg-foreground/70" />
                      <span>{bullet}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>

        <div className="mt-6">
          <Link
            href="/dashboard/new/album"
            className="inline-flex items-center rounded-full bg-foreground px-6 py-3 text-xs font-semibold uppercase tracking-[0.2em] text-background transition hover:-translate-y-0.5 hover:bg-amber-200 hover:text-slate-900"
          >
            음반심의 신청하러 가기
          </Link>
        </div>
      </section>

      <section className="mt-12 rounded-[32px] border border-border/60 bg-card/80 p-8 shadow-[0_22px_70px_rgba(15,23,42,0.1)]">
        <h2 className="font-display mt-4 text-2xl text-foreground">
          뮤직비디오 심의, 이렇게 진행됩니다
        </h2>

        <div className="mt-6 grid gap-4 lg:grid-cols-3">
          {mvSteps.map((step) => (
            <div
              key={step.number}
              className="rounded-2xl border border-border/60 bg-background/70 p-5"
            >
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-foreground text-xs font-semibold uppercase tracking-[0.2em] text-background">
                  {step.number}
                </span>
                <div>
                  <p className="text-sm font-semibold text-foreground">
                    {step.title}
                  </p>
                </div>
              </div>
              <p className="mt-3 text-sm text-muted-foreground">
                {step.description}
              </p>
              {step.bullets && (
                <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
                  {step.bullets.map((bullet) => (
                    <li key={bullet} className="flex gap-2">
                      <span className="mt-1 h-1.5 w-1.5 rounded-full bg-foreground/70" />
                      <span>{bullet}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>

        <div className="mt-6">
          <Link
            href="/dashboard/new/mv"
            className="inline-flex items-center rounded-full bg-foreground px-6 py-3 text-xs font-semibold uppercase tracking-[0.2em] text-background transition hover:-translate-y-0.5 hover:bg-amber-200 hover:text-slate-900"
          >
            M/V 심의 신청하러 가기
          </Link>
        </div>
      </section>
    </div>
  );
}
