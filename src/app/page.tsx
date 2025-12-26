import Link from "next/link";

import { HomeReviewPanel } from "@/features/home/home-review-panel";
import { createServerSupabase } from "@/lib/supabase/server";

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
    description: "결제 확인부터 최종 결과까지 단계별로 관리합니다.",
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
    description: "TV 송출/온라인 업로드 심의를 분리해 효율적으로.",
    href: "/dashboard/new/mv",
  },
  {
    title: "원클릭 접수",
    description: "반복 심의는 템플릿으로 더 빠르게 준비합니다.",
    href: "/dashboard/new",
  },
];

const sampleStations = [
  {
    id: "sample-1",
    status: "NOT_SENT",
    updated_at: new Date(Date.now() + 86400000).toISOString(),
    station: { name: "KBS" },
  },
  {
    id: "sample-2",
    status: "RECEIVED",
    updated_at: new Date(Date.now() - 86400000 * 2).toISOString(),
    station: { name: "MBC" },
  },
  {
    id: "sample-3",
    status: "APPROVED",
    updated_at: new Date(Date.now() - 86400000 * 5).toISOString(),
    station: { name: "SBS" },
  },
  {
    id: "sample-4",
    status: "NEEDS_FIX",
    updated_at: new Date(Date.now() - 86400000 * 3).toISOString(),
    station: { name: "EBS" },
  },
  {
    id: "sample-5",
    status: "NOT_SENT",
    updated_at: new Date(Date.now() + 86400000 * 2).toISOString(),
    station: { name: "Mnet" },
  },
  {
    id: "sample-6",
    status: "RECEIVED",
    updated_at: new Date(Date.now() - 86400000).toISOString(),
    station: { name: "JTBC" },
  },
];

export default async function Home() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isLoggedIn = Boolean(user);
  const heroVideoDesktop =
    process.env.NEXT_PUBLIC_HERO_VIDEO_DESKTOP ??
    "/media/hero/onside-hero-desktop.mp4";
  const heroVideoMobile =
    process.env.NEXT_PUBLIC_HERO_VIDEO_MOBILE ??
    "/media/hero/onside-hero-mobile.mp4";
  const heroVideoPoster =
    process.env.NEXT_PUBLIC_HERO_VIDEO_POSTER ??
    "/media/hero/onside-hero-poster.jpg";
  const hasHeroVideo = Boolean(heroVideoDesktop || heroVideoMobile);

  const sampleAlbum = {
    id: "sample-album",
    title: "샘플 앨범 심의",
    status: "IN_PROGRESS",
    updated_at: new Date().toISOString(),
  };
  const sampleMv = {
    id: "sample-mv",
    title: "샘플 MV 심의",
    status: "WAITING_PAYMENT",
    updated_at: new Date().toISOString(),
  };

  let albumSubmission: typeof sampleAlbum | null = isLoggedIn
    ? null
    : sampleAlbum;
  let mvSubmission: typeof sampleMv | null = isLoggedIn ? null : sampleMv;
  let albumStations = isLoggedIn ? [] : sampleStations;
  let mvStations = isLoggedIn ? [] : sampleStations;
  let albumDetailHref = "/track";
  let mvDetailHref = "/track";

  if (user) {
    const { data: albumData } = await supabase
      .from("submissions")
      .select("id, title, status, updated_at")
      .eq("user_id", user.id)
      .eq("type", "ALBUM")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: mvData } = await supabase
      .from("submissions")
      .select("id, title, status, updated_at, type")
      .eq("user_id", user.id)
      .in("type", ["MV_DISTRIBUTION", "MV_BROADCAST"])
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    albumSubmission = albumData ?? null;
    mvSubmission = mvData ?? null;

    if (albumSubmission) {
      albumDetailHref = `/dashboard/submissions/${albumSubmission.id}`;
      const { data: albumReviews } = await supabase
        .from("station_reviews")
        .select("id, status, updated_at, station:stations ( name )")
        .eq("submission_id", albumSubmission.id)
        .order("updated_at", { ascending: false });

      albumStations = albumReviews ?? [];
    }

    if (mvSubmission) {
      mvDetailHref = `/dashboard/submissions/${mvSubmission.id}`;
      const { data: mvReviews } = await supabase
        .from("station_reviews")
        .select("id, status, updated_at, station:stations ( name )")
        .eq("submission_id", mvSubmission.id)
        .order("updated_at", { ascending: false });

      mvStations = mvReviews ?? [];
    }
  }

  return (
    <div className="relative overflow-hidden">
      <div className="pointer-events-none absolute left-[-20%] top-[-10%] h-[420px] w-[420px] rounded-full bg-amber-200/60 blur-[160px] dark:bg-amber-300/20" />
      <div className="pointer-events-none absolute right-[-15%] top-[10%] h-[380px] w-[380px] rounded-full bg-indigo-200/40 blur-[160px] dark:bg-indigo-400/20" />
      <div className="pointer-events-none absolute bottom-[-10%] left-[20%] h-[320px] w-[320px] rounded-full bg-rose-200/40 blur-[160px] dark:bg-rose-400/20" />

      <section className="mx-auto w-full max-w-6xl px-6 pb-10 pt-14">
        <div className="relative overflow-hidden rounded-[36px] border border-border/60 bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.94),_rgba(254,249,237,0.92),_rgba(248,244,255,0.9))] shadow-[0_24px_80px_rgba(31,41,55,0.15)] dark:bg-[radial-gradient(circle_at_top,_rgba(36,38,53,0.95),_rgba(26,27,38,0.95),_rgba(21,22,31,0.95))]">
          <div className="absolute inset-0">
            {hasHeroVideo ? (
              <>
                <video
                  className="hidden h-full w-full object-cover opacity-70 sm:block"
                  poster={heroVideoPoster}
                  autoPlay
                  muted
                  loop
                  playsInline
                  preload="metadata"
                >
                  <source src={heroVideoDesktop} type="video/mp4" />
                </video>
                <video
                  className="h-full w-full object-cover opacity-70 sm:hidden"
                  poster={heroVideoPoster}
                  autoPlay
                  muted
                  loop
                  playsInline
                  preload="metadata"
                >
                  <source
                    src={heroVideoMobile || heroVideoDesktop}
                    type="video/mp4"
                  />
                </video>
              </>
            ) : (
              <div className="h-full w-full bg-gradient-to-br from-amber-100/80 via-white/80 to-indigo-100/70 dark:from-amber-300/10 dark:via-white/5 dark:to-indigo-300/10" />
            )}
            <div className="absolute inset-0 bg-gradient-to-r from-background via-background/70 to-transparent" />
          </div>

          <div className="relative z-10 grid gap-10 p-8 lg:grid-cols-[1.05fr_0.95fr]">
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
              <span className="inline-flex items-center rounded-full border border-border/60 bg-background/80 px-4 py-2 text-xs font-semibold uppercase tracking-[0.3em] text-foreground/80">
                심의 접수 플랫폼
              </span>
              <h1 className="font-display text-4xl leading-tight text-foreground sm:text-5xl">
                Onside에서 음원과 MV 심의를
                <br />
                한 번에 접수하고 관리하세요.
              </h1>
              <p className="max-w-xl text-base text-muted-foreground sm:text-lg">
                접수부터 결과 통보까지 모두 온라인으로. 패키지 선택, 파일
                업로드, 진행 상태 추적을 한 화면에서 해결합니다.
              </p>
              <div className="flex flex-wrap gap-3">
                <Link
                  href="/dashboard/new/album"
                  className="inline-flex items-center rounded-full bg-foreground px-6 py-3 text-sm font-semibold text-background transition hover:-translate-y-0.5 hover:bg-foreground/90"
                >
                  음반 심의 신청
                </Link>
                <Link
                  href="/dashboard/new/mv"
                  className="inline-flex items-center rounded-full border border-border/70 bg-background/70 px-6 py-3 text-sm font-semibold text-foreground transition hover:-translate-y-0.5 hover:border-foreground"
                >
                  뮤직비디오 심의 신청
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

            <HomeReviewPanel
              isLoggedIn={isLoggedIn}
              albumSubmission={albumSubmission}
              mvSubmission={mvSubmission}
              albumStations={albumStations}
              mvStations={mvStations}
              albumDetailHref={albumDetailHref}
              mvDetailHref={mvDetailHref}
            />
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
            신청서(구양식) 다운로드 접수 안내 →
          </Link>
        </div>
        <div className="mt-8 grid gap-6 md:grid-cols-3">
          {serviceCards.map((card, index) => (
            <Link
              key={card.title}
              href={card.href}
              className={`group rounded-3xl border border-border/60 p-6 transition hover:-translate-y-1 hover:border-foreground ${
                index === 0
                  ? "bg-gradient-to-br from-amber-50/80 via-white/70 to-amber-100/80 dark:from-amber-300/10 dark:via-white/5 dark:to-amber-400/10"
                  : index === 1
                    ? "bg-gradient-to-br from-indigo-50/80 via-white/70 to-indigo-100/80 dark:from-indigo-300/10 dark:via-white/5 dark:to-indigo-400/10"
                    : "bg-gradient-to-br from-rose-50/80 via-white/70 to-rose-100/80 dark:from-rose-300/10 dark:via-white/5 dark:to-rose-400/10"
              }`}
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
                상품/방송국 패키지 선택부터 결제 확인까지 흐름을 간단하게
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
            {["패키지 선택", "신청서 업로드", "옵션 선택", "결제하기", "접수 완료"].map(
              (label, index) => (
                <div
                  key={label}
                  className="rounded-2xl border border-border/60 bg-card/70 p-4"
                >
                  <p className="text-xs font-semibold text-muted-foreground">
                    STEP {String(index + 1).padStart(2, "0")}
                  </p>
                  <p className="mt-2 text-sm font-semibold text-foreground">
                    {label}
                  </p>
                </div>
              ),
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
