import Link from "next/link";

const featureHighlights = [
  {
    title: "실시간 진행 알림",
    description: "방송국별 심의 상태 변경을 즉시 반영해 최신 정보를 제공합니다.",
  },
  {
    title: "파일 업로드",
    description: "대용량 음원/영상 파일도 안전하게 업로드하고 관리합니다.",
  },
  {
    title: "관리자 승인",
    description: "무통장 입금 확인부터 최종 결과까지 단계별로 관리합니다.",
  },
];

const serviceCards = [
  {
    title: "음반 심의",
    description: "트랙 정보 입력과 음원 파일 업로드까지 한 번에.",
    href: "/dashboard/new/album",
  },
  {
    title: "M/V 심의",
    description: "유통용 · 방송용 심의 접수를 분리해 효율적으로.",
    href: "/dashboard/new/mv",
  },
  {
    title: "원클릭 접수",
    description: "반복 심의는 템플릿으로 더 빠르게 준비합니다.",
    href: "/dashboard/new",
  },
];

const steps = [
  { label: "패키지 선택", detail: "방송국 묶음/옵션 선택" },
  { label: "신청서 업로드", detail: "음원, 영상, 가사 자료 등록" },
  { label: "옵션 설정", detail: "사전검토 · 노래방 요청" },
  { label: "무통장 입금", detail: "입금자명 입력 및 확인" },
  { label: "접수 완료", detail: "진행 상황 실시간 추적" },
];

const timeline = [
  { title: "SUBMITTED", detail: "접수 완료 및 파일 검수" },
  { title: "PAYMENT", detail: "입금 확인 및 결제 승인" },
  { title: "PRE-REVIEW", detail: "사전검토 진행(옵션)" },
  { title: "IN REVIEW", detail: "방송국별 심의 진행" },
  { title: "RESULT", detail: "승인/수정 요청 통보" },
];

const stationPreview = [
  { name: "KBS", status: "RECEIVED" },
  { name: "MBC", status: "IN REVIEW" },
  { name: "SBS", status: "APPROVED" },
  { name: "EBS", status: "NEEDS FIX" },
];

export default function Home() {
  return (
    <div className="relative overflow-hidden">
      <div className="pointer-events-none absolute left-[-20%] top-[-10%] h-[420px] w-[420px] rounded-full bg-emerald-400/20 blur-[140px] dark:bg-emerald-500/20" />
      <div className="pointer-events-none absolute right-[-10%] top-[10%] h-[360px] w-[360px] rounded-full bg-amber-300/20 blur-[130px] dark:bg-amber-400/20" />

      <section className="mx-auto grid w-full max-w-6xl items-center gap-12 px-6 pb-14 pt-16 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-6">
          <span className="inline-flex items-center rounded-full border border-border/60 bg-background/80 px-4 py-2 text-xs font-semibold uppercase tracking-[0.3em] text-foreground/80">
            심의 접수 플랫폼
          </span>
          <h1 className="font-display text-4xl leading-tight text-foreground sm:text-5xl">
            Onside에서 음원과 MV 심의를
            <br />
            한 번에 접수하고 관리하세요.
          </h1>
          <p className="max-w-xl text-base text-muted-foreground sm:text-lg">
            접수부터 결과 통보까지 모두 온라인으로. 패키지 선택, 파일 업로드,
            진행 상태 추적을 한 화면에서 해결합니다.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link
              href="/dashboard/new"
              className="inline-flex items-center rounded-full bg-foreground px-6 py-3 text-sm font-semibold text-background transition hover:-translate-y-0.5 hover:bg-foreground/90"
            >
              온라인 심의 신청
            </Link>
            <Link
              href="/guide"
              className="inline-flex items-center rounded-full border border-border/70 px-6 py-3 text-sm font-semibold text-foreground transition hover:-translate-y-0.5 hover:border-foreground"
            >
              심의 안내 보기
            </Link>
          </div>
          <div className="grid gap-4 pt-6 sm:grid-cols-3">
            {featureHighlights.map((feature) => (
              <div
                key={feature.title}
                className="rounded-2xl border border-border/60 bg-background/80 p-4 shadow-sm"
              >
                <p className="text-sm font-semibold text-foreground">
                  {feature.title}
                </p>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                  {feature.description}
                </p>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-[32px] border border-border/60 bg-card/90 p-6 shadow-[0_24px_80px_rgba(15,23,42,0.18)]">
          <div className="flex items-center justify-between text-xs uppercase tracking-[0.2em] text-muted-foreground">
            <span>접수 현황</span>
            <span>Live</span>
          </div>
          <div className="mt-6 space-y-5">
            <div className="rounded-2xl border border-dashed border-border/80 bg-background/60 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
                STEP 01-05
              </p>
              <p className="mt-2 text-sm font-semibold text-foreground">
                패키지 선택 → 파일 업로드 → 옵션 선택 → 무통장 입금 → 접수 완료
              </p>
            </div>
            <div className="rounded-2xl border border-border/60 bg-background/80 p-4">
              <p className="text-sm font-semibold text-foreground">
                방송국별 진행 상황
              </p>
              <div className="mt-3 grid gap-2 text-xs">
                {stationPreview.map((station) => (
                  <div
                    key={station.name}
                    className="flex items-center justify-between rounded-full border border-border/60 bg-background/70 px-3 py-2"
                  >
                    <span className="font-semibold text-foreground">
                      {station.name}
                    </span>
                    <span className="text-muted-foreground">
                      {station.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-2xl border border-border/60 bg-background/80 p-4">
              <p className="text-sm font-semibold text-foreground">
                입금 확인 대기
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                관리자 승인 후 자동으로 상태가 업데이트됩니다.
              </p>
              <div className="mt-3 h-1.5 w-full rounded-full bg-muted">
                <div className="h-1.5 w-2/5 rounded-full bg-foreground" />
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-6xl px-6 py-12">
        <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
              심의 메뉴
            </p>
            <h2 className="font-display mt-3 text-3xl text-foreground">
              필요한 심의 유형을 빠르게 선택하세요.
            </h2>
          </div>
          <Link
            href="/forms"
            className="text-sm font-semibold text-muted-foreground transition hover:text-foreground"
          >
            신청서 다운로드 안내 →
          </Link>
        </div>
        <div className="mt-8 grid gap-6 md:grid-cols-3">
          {serviceCards.map((card) => (
            <Link
              key={card.title}
              href={card.href}
              className="group rounded-3xl border border-border/60 bg-card/80 p-6 transition hover:-translate-y-1 hover:border-foreground"
            >
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
                Onside
              </p>
              <h3 className="mt-4 text-xl font-semibold text-foreground">
                {card.title}
              </h3>
              <p className="mt-2 text-sm text-muted-foreground">
                {card.description}
              </p>
              <div className="mt-6 text-sm font-semibold text-foreground">
                바로 시작하기 →
              </div>
            </Link>
          ))}
        </div>
      </section>

      <section className="mx-auto w-full max-w-6xl px-6 py-12">
        <div className="rounded-[32px] border border-border/60 bg-background/80 px-8 py-10">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
                접수 프로세스
              </p>
              <h2 className="font-display mt-3 text-3xl text-foreground">
                STEP 01-05로 한 번에 끝내기
              </h2>
              <p className="mt-3 max-w-xl text-sm text-muted-foreground">
                상품/방송국 패키지 선택부터 입금 확인까지 흐름을 간단하게
                설계했습니다.
              </p>
            </div>
            <Link
              href="/dashboard/new"
              className="inline-flex items-center rounded-full border border-border/70 px-5 py-2 text-sm font-semibold text-foreground transition hover:border-foreground"
            >
              바로 접수 시작 →
            </Link>
          </div>
          <div className="mt-8 grid gap-4 md:grid-cols-5">
            {steps.map((step, index) => (
              <div
                key={step.label}
                className="rounded-2xl border border-border/60 bg-card/70 p-4"
              >
                <p className="text-xs font-semibold text-muted-foreground">
                  STEP {String(index + 1).padStart(2, "0")}
                </p>
                <p className="mt-2 text-sm font-semibold text-foreground">
                  {step.label}
                </p>
                <p className="mt-2 text-xs text-muted-foreground">
                  {step.detail}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-6xl px-6 pb-20 pt-10">
        <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr]">
          <div className="space-y-6">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
              진행 상태
            </p>
            <h2 className="font-display text-3xl text-foreground">
              방송국별 상태를 실시간으로 추적합니다.
            </h2>
            <p className="text-sm text-muted-foreground">
              관리자 업데이트가 즉시 반영되어 접수 내역 페이지에서 최신 정보를
              확인할 수 있습니다.
            </p>
            <div className="space-y-4">
              {timeline.map((item, index) => (
                <div
                  key={item.title}
                  className="flex items-start gap-4 rounded-2xl border border-border/60 bg-background/70 p-4"
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-full border border-border/80 text-xs font-semibold text-foreground">
                    {String(index + 1).padStart(2, "0")}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground">
                      {item.title}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {item.detail}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-[32px] border border-border/60 bg-card/80 p-6">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-foreground">
                방송국별 진행 표
              </h3>
              <span className="text-xs text-muted-foreground">오늘 업데이트</span>
            </div>
            <div className="mt-4 space-y-3 text-sm">
              {stationPreview.map((station) => (
                <div
                  key={station.name}
                  className="flex items-center justify-between rounded-2xl border border-border/60 bg-background/80 px-4 py-3"
                >
                  <span className="font-semibold text-foreground">
                    {station.name}
                  </span>
                  <span className="text-xs font-semibold text-muted-foreground">
                    {station.status}
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-6 rounded-2xl border border-dashed border-border/80 bg-background/70 p-4 text-xs text-muted-foreground">
              심의 결과 통보, 수정 요청 사항, 최종 완료 상태가 이 영역에
              표시됩니다.
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
