import Link from "next/link";

import { StripAdBanner } from "@/components/site/strip-ad-banner";
import { ScrollRevealObserver } from "@/components/scroll-reveal-observer";
import { HomeReviewPanel } from "@/features/home/home-review-panel";
import { ensureAlbumStationReviews, getPackageStations } from "@/lib/station-reviews";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const RECENT_RESULT_CUTOFF = new Date(
  Date.now() - 30 * 24 * 60 * 60 * 1000,
).toISOString();

const heroCtas = [
  {
    title: "음반 심의 신청",
    href: "/dashboard/new/album",
    visual: "from-[#dff1ff] via-[#fef5e7] to-[#eef6ff]",
    icon: (
      <svg
        viewBox="0 0 160 120"
        className="h-24 w-24 drop-shadow-[0_14px_30px_rgba(59,130,246,0.35)]"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="albumSleeve" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#e0f2ff" />
            <stop offset="100%" stopColor="#b8d9ff" />
          </linearGradient>
          <linearGradient id="albumDisc" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#6aa9ff" />
            <stop offset="100%" stopColor="#3b82f6" />
          </linearGradient>
        </defs>
        <rect
          x="18"
          y="20"
          width="72"
          height="80"
          rx="18"
          fill="url(#albumSleeve)"
        />
        <rect
          x="28"
          y="30"
          width="52"
          height="60"
          rx="14"
          fill="#ffffff"
          opacity="0.65"
        />
        <circle cx="112" cy="60" r="28" fill="url(#albumDisc)" />
        <circle cx="112" cy="60" r="10" fill="#f8fbff" opacity="0.9" />
        <circle cx="112" cy="60" r="4" fill="#dbeafe" />
      </svg>
    ),
  },
  {
    title: "뮤직비디오 심의 신청",
    href: "/dashboard/new/mv",
    visual: "from-[#e6f0ff] via-[#f6f3ff] to-[#e7f7ff]",
    icon: (
      <svg
        viewBox="0 0 160 120"
        className="h-24 w-24 drop-shadow-[0_14px_30px_rgba(99,102,241,0.35)]"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="mvScreen" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#a5b4fc" />
            <stop offset="100%" stopColor="#6366f1" />
          </linearGradient>
          <linearGradient id="mvPlay" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#fef3c7" />
            <stop offset="100%" stopColor="#f59e0b" />
          </linearGradient>
        </defs>
        <rect x="18" y="22" width="124" height="76" rx="20" fill="url(#mvScreen)" />
        <rect x="28" y="32" width="104" height="56" rx="16" fill="#ffffff" opacity="0.18" />
        <polygon points="76,44 76,76 104,60" fill="url(#mvPlay)" />
        <circle cx="124" cy="36" r="6" fill="#ffffff" opacity="0.35" />
      </svg>
    ),
  },
];

const featureHighlights = [
  {
    title: "실시간 진행 알림",
    description:
      "방송국별 심의 진행 상황을 실시간으로 확인하세요.\n회원/비회원 누구나",
    card:
      "bg-[#f7f8fb] text-[#2d3444] border-white/80 shadow-[0_16px_40px_rgba(15,23,42,0.08)]",
    visual: "from-[#d7ecff] via-white to-[#eef6ff]",
    icon: (
      <svg
        viewBox="0 0 96 96"
        className="h-16 w-16 drop-shadow-[0_12px_24px_rgba(59,130,246,0.35)]"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="signalOrb" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#9ecbff" />
            <stop offset="100%" stopColor="#4f7cff" />
          </linearGradient>
        </defs>
        <circle cx="48" cy="52" r="18" fill="url(#signalOrb)" />
        <path
          d="M28 52a20 20 0 0 1 40 0"
          fill="none"
          stroke="#7db0ff"
          strokeWidth="4"
          strokeLinecap="round"
          opacity="0.6"
        />
        <path
          d="M20 52a28 28 0 0 1 56 0"
          fill="none"
          stroke="#7db0ff"
          strokeWidth="3"
          strokeLinecap="round"
          opacity="0.35"
        />
        <circle cx="48" cy="52" r="4" fill="#ffffff" opacity="0.9" />
      </svg>
    ),
  },
  {
    title: "파일 업로드",
    description:
      "온사이드는 자체 스토리지 운영으로 안전하게 음원과 영상을 관리합니다.",
    card:
      "bg-white text-[#2d3444] border-[#eef2f7] shadow-[0_16px_40px_rgba(15,23,42,0.08)]",
    visual: "from-[#e7fff2] via-white to-[#eaf7ff]",
    icon: (
      <svg
        viewBox="0 0 96 96"
        className="h-16 w-16 drop-shadow-[0_12px_24px_rgba(16,185,129,0.3)]"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="uploadCloud" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#a7f3d0" />
            <stop offset="100%" stopColor="#34d399" />
          </linearGradient>
        </defs>
        <circle cx="34" cy="52" r="14" fill="url(#uploadCloud)" />
        <circle cx="52" cy="44" r="16" fill="url(#uploadCloud)" />
        <circle cx="70" cy="52" r="14" fill="url(#uploadCloud)" />
        <rect x="24" y="52" width="56" height="18" rx="9" fill="url(#uploadCloud)" />
        <path d="M48 30v26" stroke="#0f172a" strokeWidth="5" strokeLinecap="round" />
        <path
          d="M38 40l10-10 10 10"
          fill="none"
          stroke="#0f172a"
          strokeWidth="5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  {
    title: "관리자 승인",
    description:
      "접수 시 1차 체크, 방송국 전달 전 2차 검수로 빈틈 없이",
    card:
      "bg-[#eef2ff] text-[#2d3444] border-[#dbe5ff] shadow-[0_16px_40px_rgba(15,23,42,0.08)]",
    visual: "from-[#fff4d6] via-white to-[#ffe9d6]",
    icon: (
      <svg
        viewBox="0 0 96 96"
        className="h-16 w-16 drop-shadow-[0_12px_24px_rgba(245,158,11,0.3)]"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="shieldCore" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#fde68a" />
            <stop offset="100%" stopColor="#f59e0b" />
          </linearGradient>
        </defs>
        <path
          d="M48 12l26 10v22c0 16-10 30-26 36-16-6-26-20-26-36V22z"
          fill="url(#shieldCore)"
        />
        <path
          d="M34 48l10 10 18-18"
          fill="none"
          stroke="#ffffff"
          strokeWidth="6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
];

const scrollRevealBaseClass =
  "opacity-0 translate-y-6 transition-all duration-700 ease-out will-change-transform data-[reveal-state=visible]:opacity-100 data-[reveal-state=visible]:translate-y-0 motion-reduce:opacity-100 motion-reduce:translate-y-0";

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
    description: "멜론 링크와 음원 파일만 제출하는 음반 전용 간편 접수.",
    href: "/dashboard/new/album?mode=oneclick",
  },
];

const processStepTones = [
  "border-border/70 bg-card/80 text-foreground shadow-[0_10px_24px_rgba(0,0,0,0.08)]",
  "border-border/70 bg-card/80 text-foreground shadow-[0_10px_24px_rgba(0,0,0,0.08)]",
  "border-border/70 bg-card/80 text-foreground shadow-[0_10px_24px_rgba(0,0,0,0.08)]",
  "border-border/70 bg-card/80 text-foreground shadow-[0_10px_24px_rgba(0,0,0,0.08)]",
];

const serviceCardTones = [
  "bg-[#8fe38f] text-[#111111] border-transparent",
  "bg-[#e6e35b] text-[#111111] border-transparent",
  "oneclick-card text-[#111111] border-transparent",
];

type StationSnapshot = {
  id: string;
  status: string;
  updated_at: string;
  result_note?: string | null;
  track_results?: unknown;
  station?: {
    id?: string | null;
    name?: string | null;
    code?: string | null;
    logo_url?: string | null;
  } | null;
};

type SubmissionSnapshot = {
  id: string;
  title: string;
  artist_name?: string | null;
  status: string;
  payment_status: string | null;
  updated_at: string;
  type?: string;
  package_id?: string | null;
  package?:
  | Array<{ name?: string | null; station_count?: number | null }>
  | { name?: string | null; station_count?: number | null }
  | null;
};

const sampleStations: StationSnapshot[] = [
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
    station: { name: "YTN" },
  },
  {
    id: "sample-5",
    status: "NOT_SENT",
    updated_at: new Date(Date.now() + 86400000 * 2).toISOString(),
    station: { name: "CBS 기독교방송" },
  },
  {
    id: "sample-6",
    status: "RECEIVED",
    updated_at: new Date(Date.now() - 86400000).toISOString(),
    station: { name: "Arirang 방송" },
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
    "/media/hero/glit-hero-desktop.mp4";
  const heroVideoMobile =
    process.env.NEXT_PUBLIC_HERO_VIDEO_MOBILE ??
    "/media/hero/glit-hero-mobile.mp4";
  const heroVideoPoster =
    process.env.NEXT_PUBLIC_HERO_VIDEO_POSTER ??
    "/media/hero/glit-hero-poster.jpg";
  const hasHeroVideo = Boolean(heroVideoDesktop || heroVideoMobile);

  const sampleAlbum: SubmissionSnapshot = {
    id: "sample-album",
    title: "샘플 앨범 심의",
    artist_name: "온사이드",
    status: "IN_PROGRESS",
    payment_status: "PAID",
    updated_at: new Date().toISOString(),
  };
  const sampleMv: SubmissionSnapshot = {
    id: "sample-mv",
    title: "샘플 MV 심의",
    artist_name: "온사이드",
    status: "WAITING_PAYMENT",
    payment_status: "PAYMENT_PENDING",
    updated_at: new Date().toISOString(),
  };

  let albumSubmissions: SubmissionSnapshot[] = isLoggedIn ? [] : [sampleAlbum];
  let mvSubmissions: SubmissionSnapshot[] = isLoggedIn ? [] : [sampleMv];
  const albumStationsMap: Record<string, StationSnapshot[]> = isLoggedIn
    ? {}
    : { [sampleAlbum.id]: sampleStations };
  const mvStationsMap: Record<string, StationSnapshot[]> = isLoggedIn
    ? {}
    : { [sampleMv.id]: sampleStations };

  if (user) {
    const recentResultCutoff = RECENT_RESULT_CUTOFF;
    const admin = createAdminClient();
    const isResultNotifiedMissing = (error?: { message?: string; code?: string | number }) =>
      Boolean(
        error &&
          (error.code === "42703" ||
            error.code === "42P01" ||
            error.message?.toLowerCase().includes("result_notified_at")),
      );

    const buildAlbumBase = () =>
      admin
        .from("submissions")
        .select(
          "id, title, artist_name, status, updated_at, payment_status, package_id, package:packages ( name, station_count )",
        )
        .eq("user_id", user.id)
        .eq("type", "ALBUM")
        .not("status", "eq", "DRAFT");

    const buildMvBase = () =>
      admin
        .from("submissions")
        .select("id, title, artist_name, status, updated_at, payment_status, type, package_id, package:packages ( name, station_count )")
        .eq("user_id", user.id)
        .in("type", ["MV_DISTRIBUTION", "MV_BROADCAST"])
        .not("status", "eq", "DRAFT");

    let albumDataResult = await buildAlbumBase()
      .or(`result_notified_at.is.null,result_notified_at.gte.${recentResultCutoff}`)
      .order("updated_at", { ascending: false })
      .limit(5);

    if (albumDataResult.error && isResultNotifiedMissing(albumDataResult.error)) {
      console.warn("[home] result_notified_at missing for album, falling back", albumDataResult.error);
      albumDataResult = await buildAlbumBase()
        .not("status", "in", "(RESULT_READY,COMPLETED)")
        .order("updated_at", { ascending: false })
        .limit(5);
    } else if (albumDataResult.error) {
      console.error("[home] album query error", albumDataResult.error);
    }

    let mvDataResult = await buildMvBase()
      .or(`result_notified_at.is.null,result_notified_at.gte.${recentResultCutoff}`)
      .order("updated_at", { ascending: false })
      .limit(5);

    if (mvDataResult.error && isResultNotifiedMissing(mvDataResult.error)) {
      console.warn("[home] result_notified_at missing for mv, falling back", mvDataResult.error);
      mvDataResult = await buildMvBase()
        .not("status", "in", "(RESULT_READY,COMPLETED)")
        .order("updated_at", { ascending: false })
        .limit(5);
    } else if (mvDataResult.error) {
      console.error("[home] mv query error", mvDataResult.error);
    }

    albumSubmissions = albumDataResult.data ?? [];
    mvSubmissions = mvDataResult.data ?? [];

    const packageIds = Array.from(
      new Set(
        [...albumSubmissions, ...mvSubmissions]
          .map((item) => item.package_id)
          .filter((id): id is string => Boolean(id)),
      ),
    );

    const packageMap = new Map<string, { id: string; name: string | null; station_count: number | null }>();
    const packageStationsMap = new Map<string, Array<{ id: string; code: string | null; name: string | null }>>();

    if (packageIds.length) {
      const { data: packages, error: packageError } = await admin
        .from("packages")
        .select("id, name, station_count")
        .in("id", packageIds);
      if (packageError) {
        console.error("[home] package fallback query error", packageError);
      }
      (packages ?? []).forEach((pkg) => {
        packageMap.set(pkg.id, {
          id: pkg.id,
          name: pkg.name ?? null,
          station_count: pkg.station_count ?? null,
        });
      });

      const { data: packageStations, error: packageStationsError } = await admin
        .from("package_stations")
        .select("package_id, station:stations ( id, code, name )")
        .in("package_id", packageIds);

      if (packageStationsError) {
        console.error("[home] package_stations query error", packageStationsError);
      }

      (packageStations ?? []).forEach((row) => {
        const pkgId = row.package_id;
        const station = Array.isArray(row.station) ? row.station[0] : row.station;
        if (!pkgId || !station) return;
        packageStationsMap.set(pkgId, [
          ...(packageStationsMap.get(pkgId) ?? []),
          { id: station.id, code: station.code ?? null, name: station.name ?? null },
        ]);
      });
    }

    // Ensure station review placeholders
    await Promise.all(
      albumSubmissions.map(async (submission) => {
        const pkg = Array.isArray(submission.package) ? submission.package[0] : submission.package;
        const fallbackPkg = submission.package_id ? packageMap.get(submission.package_id) : null;

        const resolvedName = pkg?.name ?? fallbackPkg?.name ?? null;
        const resolvedCount = pkg?.station_count ?? fallbackPkg?.station_count ?? null;

        console.log("[home] ensure stations album", {
          submissionId: submission.id,
          packageId: submission.package_id,
          joinPkg: pkg,
          fallbackPkg,
          resolvedName,
          resolvedCount,
        });

        await ensureAlbumStationReviews(
          admin,
          submission.id,
          resolvedCount,
          resolvedName,
        );
      }),
    );
    await Promise.all(
      mvSubmissions.map(async (submission) => {
        const pkg = Array.isArray(submission.package) ? submission.package[0] : submission.package;
        const fallbackPkg = submission.package_id ? packageMap.get(submission.package_id) : null;

        const resolvedName = pkg?.name ?? fallbackPkg?.name ?? null;
        const resolvedCount = pkg?.station_count ?? fallbackPkg?.station_count ?? null;

        console.log("[home] ensure stations mv", {
          submissionId: submission.id,
          packageId: submission.package_id,
          joinPkg: pkg,
          fallbackPkg,
          resolvedName,
          resolvedCount,
        });

        await ensureAlbumStationReviews(
          admin,
          submission.id,
          resolvedCount,
          resolvedName,
        );
      }),
    );

    if (albumSubmissions.length) {
      await Promise.all(
        albumSubmissions.map(async (submission) => {
          const packageInfo = Array.isArray(submission.package) ? submission.package[0] : submission.package;
          submission.package = packageInfo ? [packageInfo] : null;
          const fallbackPkg = submission.package_id ? packageMap.get(submission.package_id) : null;
          const resolvedName = packageInfo?.name ?? fallbackPkg?.name ?? null;
          const resolvedCount = packageInfo?.station_count ?? fallbackPkg?.station_count ?? null;

          await ensureAlbumStationReviews(
            supabase,
            submission.id,
            resolvedCount,
            resolvedName,
          );
        }),
      );
    }

    const albumIds = albumSubmissions.map((submission) => submission.id).filter(Boolean);
    const mvIds = mvSubmissions.map((submission) => submission.id).filter(Boolean);
    const allIds = [...albumIds, ...mvIds];

    if (allIds.length) {
      const withoutTracks =
        "id, submission_id, station_id, status, result_note, updated_at, station:stations!station_reviews_station_id_fkey ( id, name, code, region )";
      const withLegacyTracks =
        "id, submission_id, station_id, status, result_note, track_results, updated_at, station:stations!station_reviews_station_id_fkey ( id, name, code, region )";

      const reviewResult = await admin
        .from("station_reviews")
        .select(
          "id, submission_id, station_id, status, result_note, track_results:track_results_json, updated_at, station:stations!station_reviews_station_id_fkey ( id, name, code, region )",
        )
        .in("submission_id", allIds)
        .order("updated_at", { ascending: false });

      const missingTrackColumn =
        reviewResult.error &&
        (reviewResult.error.message?.toLowerCase().includes("track_results_json") ||
          reviewResult.error.message?.toLowerCase().includes("track_results") ||
          reviewResult.error.code === "42703");

      let reviewRows = (reviewResult.data ?? []) as ReviewRow[];
      if (missingTrackColumn) {
        const legacy = await admin
          .from("station_reviews")
          .select(withLegacyTracks)
          .in("submission_id", allIds)
          .order("updated_at", { ascending: false });
        if (legacy.error) {
          reviewRows =
            (
              await admin
                .from("station_reviews")
                .select(withoutTracks)
                .in("submission_id", allIds)
                .order("updated_at", { ascending: false })
            ).data ?? [] as ReviewRow[];
        } else {
          reviewRows = (legacy.data ?? []) as ReviewRow[];
        }
      }

      if (reviewResult.error && !reviewRows.length) {
        console.error("[home] station_reviews join error", reviewResult.error);
        const fallback = await admin
          .from("station_reviews")
          .select(
            missingTrackColumn
              ? "id, submission_id, station_id, status, result_note, track_results, updated_at, station:stations ( id, name, code, region )"
              : "id, submission_id, station_id, status, result_note, track_results:track_results_json, updated_at, station:stations ( id, name, code, region )",
          )
          .in("submission_id", allIds)
          .order("updated_at", { ascending: false });
        if (fallback.error) {
          console.error("[home] station_reviews fallback join error", fallback.error);
        }
        reviewRows = (fallback.data ?? reviewRows) as ReviewRow[];
      }

      type ReviewRow = {
        id: string;
        submission_id: string;
        station_id: string | null;
        status: string;
        result_note: string | null;
        track_results?: unknown;
        updated_at: string;
        station?:
          | { id?: string | null; name?: string | null; code?: string | null }
          | Array<{ id?: string | null; name?: string | null; code?: string | null }>
          | null;
      };

      const reviewMap = new Map<string, Map<string, ReviewRow>>();
      reviewRows.forEach((row: ReviewRow) => {
        const submissionId = row.submission_id;
        const stationId = row.station_id || (Array.isArray(row.station) ? row.station[0]?.id : row.station?.id);
        if (!submissionId || !stationId) return;
        const normalizedStation = Array.isArray(row.station) ? row.station[0] : row.station ?? null;
        const map = reviewMap.get(submissionId) ?? new Map();
        map.set(stationId, { ...row, station: normalizedStation });
        reviewMap.set(submissionId, map);
      });

      const logoFor = (code?: string | null) =>
        code ? admin.storage.from("broadcast").getPublicUrl(`${code}.png`).data.publicUrl ?? null : null;

      const buildRows = (
        submission: (typeof albumSubmissions)[number] | (typeof mvSubmissions)[number],
        targetMap: Record<string, StationSnapshot[]>,
      ) => {
        let pkgStations =
          submission.package_id && packageStationsMap.has(submission.package_id)
            ? packageStationsMap.get(submission.package_id) ?? []
            : [];

        if (!pkgStations.length) {
          const pkgInfo = Array.isArray(submission.package) ? submission.package[0] : submission.package;
          const fallbackPkg = submission.package_id ? packageMap.get(submission.package_id) : null;
          const resolvedName = pkgInfo?.name ?? fallbackPkg?.name ?? null;
          const resolvedCount = pkgInfo?.station_count ?? fallbackPkg?.station_count ?? null;
          pkgStations = getPackageStations(resolvedCount, resolvedName).map((station) => ({
            id: "",
            code: station.code,
            name: station.name,
          }));
        }

        const reviews = reviewMap.get(submission.id) ?? new Map();

        const rows = pkgStations.map((station) => {
          const review = station.id ? reviews.get(station.id) : null;
          return {
            id: review?.id ?? `placeholder-${submission.id}-${station.code ?? station.id}`,
            status: review?.status ?? submission.status ?? "NOT_SENT",
            result_note: review?.result_note ?? null,
            track_results: review?.track_results ?? null,
            updated_at: review?.updated_at ?? submission.updated_at,
            station: {
              id: station.id,
              name: station.name,
              code: station.code,
              logo_url: logoFor(station.code ?? undefined),
            },
          } as StationSnapshot;
        });

        if (rows.length === 0 && reviews.size) {
          reviews.forEach((review) => {
            const station = Array.isArray(review.station) ? review.station[0] : review.station ?? {};
            rows.push({
              ...review,
              station: {
                ...station,
                logo_url: logoFor(station.code ?? undefined),
              },
            } as StationSnapshot);
          });
        }

        if (rows.length === 0) {
          rows.push({
            id: `placeholder-${submission.id}`,
            status: submission.status || "NOT_SENT",
            result_note: null,
            track_results: null,
            updated_at: submission.updated_at,
            station: {
              id: "",
              name: Array.isArray(submission.package) ? submission.package?.[0]?.name ?? "신청 방송국" : "신청 방송국",
              code: "",
              logo_url: null,
            },
          });
        }

        targetMap[submission.id] = rows;
      };

      albumSubmissions.forEach((submission) => buildRows(submission, albumStationsMap));
      mvSubmissions.forEach((submission) => buildRows(submission, mvStationsMap));
    }
  }

  return (
    <div className="relative overflow-hidden">
      <ScrollRevealObserver />
      <div className="pointer-events-none absolute left-[-20%] top-[-10%] h-[420px] w-[420px] rounded-full bg-[#c94821]/20 blur-[180px] dark:bg-[#f05a28]/20" />
      <div className="pointer-events-none absolute right-[-15%] top-[10%] h-[380px] w-[380px] rounded-full bg-[#c6a631]/20 blur-[180px] dark:bg-[#f6d64a]/20" />
      <div className="pointer-events-none absolute bottom-[-10%] left-[20%] h-[320px] w-[320px] rounded-full bg-[#a8792c]/25 blur-[180px] dark:bg-[#f6d64a]/15" />

      <section className="w-full pb-10 pt-[1.75rem]">
        <div className="relative w-full overflow-hidden border-y border-border/60 bg-[radial-gradient(circle_at_top,_rgba(245,245,245,0.98),_rgba(231,223,213,0.92),_rgba(210,198,185,0.88))] shadow-[0_24px_80px_rgba(31,41,55,0.15)] dark:bg-[radial-gradient(circle_at_top,_rgba(11,11,11,0.95),_rgba(24,18,14,0.95),_rgba(14,14,14,0.95))]">
          <div className="absolute inset-0">
            {hasHeroVideo ? (
              <>
                <video
                  className="hidden h-full w-full object-cover opacity-100 saturate-[1.02] brightness-[0.6] contrast-[1.1] dark:opacity-80 dark:saturate-[1.3] dark:brightness-[1.12] dark:contrast-[1.12] sm:block"
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
                  className="h-full w-full object-cover object-right opacity-100 saturate-[1.02] brightness-[0.6] contrast-[1.1] dark:opacity-80 dark:saturate-[1.3] dark:brightness-[1.12] dark:contrast-[1.12] sm:hidden"
                  poster={heroVideoPoster}
                  autoPlay
                  muted
                  loop
                  playsInline
                  preload="metadata"
                >
                  <source src={heroVideoMobile || heroVideoDesktop} type="video/mp4" />
                </video>
              </>
            ) : (
              <div className="h-full w-full bg-gradient-to-br from-[#d8ecff]/80 via-white/80 to-[#f3eaff]/70 dark:from-amber-300/10 dark:via-white/5 dark:to-indigo-300/10" />
            )}
            <div className="absolute inset-0 bg-gradient-to-r from-black/35 via-black/15 to-black/5 dark:from-background/80 dark:via-background/40" />
          </div>

          <div className="relative z-10 mx-auto grid w-full max-w-6xl gap-10 px-6 py-10 lg:grid-cols-[1.05fr_0.95fr]">
            <div className="flex flex-col gap-6 animate-in fade-in slide-in-from-bottom-4 duration-700 lg:min-h-[520px] lg:h-full">
              <span className="inline-flex w-fit items-center rounded-full border border-white/60 bg-black/35 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.25em] text-white/90 backdrop-blur-sm">
                OFFICIAL MUSIC & VIDEO REVIEW
              </span>
              <h1 className="font-display text-3xl leading-tight text-white sm:text-4xl">
                <span className="inline-block animate-[floaty_6s_ease-in-out_infinite] bg-gradient-to-r from-emerald-400 via-lime-300 to-emerald-500 bg-clip-text text-transparent drop-shadow-[0_8px_24px_rgba(52,211,153,0.25)]">
                  온사이드(onside)
                </span>
                <br />
                음반 · M/V 심의를 쉽고 빠르게!
              </h1>
              <p className="max-w-xl text-base text-white/85 sm:text-lg whitespace-pre-line">
                온사이드에서 방송사별 심의 진행을 실시간으로 받아보세요.
                {"\n"}나의 모든 심의 기록은 온사이드에서 모아 관리할 수 있습니다.
              </p>
              <div className="grid grid-cols-2 gap-3 sm:gap-4">
                {heroCtas.map((cta) => (
                  <Link
                    key={cta.title}
                    href={cta.href}
                    className="group overflow-hidden rounded-[28px] border border-white/60 bg-white/10 backdrop-blur-sm shadow-[0_18px_50px_rgba(0,0,0,0.28)] transition hover:-translate-y-1 hover:shadow-[0_22px_60px_rgba(0,0,0,0.35)]"
                  >
                    <div
                      className={`relative flex h-28 items-center justify-center overflow-hidden bg-gradient-to-br sm:h-32 ${cta.visual}`}
                    >
                      <div className="absolute -left-6 top-[-22px] h-20 w-20 rounded-full bg-white/50 blur-xl" />
                      <div className="absolute -right-6 bottom-[-28px] h-24 w-24 rounded-full bg-white/55 blur-xl" />
                      {cta.icon}
                    </div>
                    <div className="px-5 py-4 text-center">
                      <p className="text-base font-semibold text-white drop-shadow">{cta.title}</p>
                    </div>
                  </Link>
                ))}
              </div>

              <div className="hidden gap-5 pt-5 sm:grid sm:grid-cols-3 lg:mt-auto">
                {featureHighlights.map((feature) => (
                  <div key={feature.title} className="group [perspective:1200px]">
                    <div
                      className={`flip-card relative min-h-[170px] overflow-hidden rounded-[28px] border ${feature.card} transition-transform duration-500 group-hover:[transform:rotateY(180deg)]`}
                    >
                      <div className="flip-face absolute inset-0 z-0 flex flex-col p-5 text-center transition-opacity duration-300 group-hover:opacity-0">
                        <div
                          className={`relative mb-2 flex h-16 items-center justify-center overflow-hidden rounded-[18px] bg-gradient-to-br ${feature.visual}`}
                        >
                          <div className="absolute -right-7 -top-6 h-12 w-12 rounded-full bg-white/70 blur-lg" />
                          <div className="absolute -left-6 bottom-[-14px] h-10 w-10 rounded-full bg-white/60 blur-md" />
                          {feature.icon}
                        </div>
                        <p className="text-base font-semibold text-[#1f2733]">
                          {feature.title}
                        </p>
                      </div>
                      <div className="absolute inset-0 z-10 flex items-center justify-center px-5 text-center opacity-0 transition-opacity duration-300 [transform:rotateY(180deg)] group-hover:opacity-100">
                        <p className="text-sm font-semibold text-[#1f2733] whitespace-pre-line">
                          {feature.description}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <HomeReviewPanel
              isLoggedIn={isLoggedIn}
              albumSubmissions={albumSubmissions}
              mvSubmissions={mvSubmissions}
              albumStationsMap={albumStationsMap}
              mvStationsMap={mvStationsMap}
            />
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-6xl px-6 pb-12 pt-4">
        <div className="mb-14">
          {/* Center strip banner only */}
          <StripAdBanner />
        </div>

        <div
          data-scroll-reveal
          data-reveal-state="hidden"
          className={`flex flex-col gap-6 md:flex-row md:items-end md:justify-between ${scrollRevealBaseClass}`}
          style={{ transitionDelay: "0ms" }}
        >
          <div />
          <Link
            href="/forms"
            className="self-end text-sm font-semibold text-muted-foreground transition hover:text-foreground md:self-auto"
          >
            신청서(구양식) 다운로드 접수 안내 →
          </Link>
        </div>

        <div className="mt-8 grid gap-6 md:grid-cols-3">
          {serviceCards.map((card, index) => (
            <Link
              key={card.title}
              href={card.href}
              data-scroll-reveal
              data-reveal-state="hidden"
              style={{ transitionDelay: `${120 + index * 120}ms` }}
              className={`group relative flex min-h-[190px] flex-col justify-between rounded-[28px] border p-6 shadow-[0_18px_45px_rgba(0,0,0,0.25)] transition hover:-translate-y-1 ${scrollRevealBaseClass} ${serviceCardTones[index] ?? "bg-white text-[#111111] border-border/60"
                }`}
            >
              <div className="space-y-3">
                <h3 className="text-2xl font-semibold leading-snug">{card.title}</h3>
                <p className="text-sm opacity-80">{card.description}</p>
              </div>
              <div className="mt-6 flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-[0.2em] opacity-70">
                  바로가기
                </span>
                <span className="flex h-10 w-10 items-center justify-center rounded-full border border-black/40 bg-black/10 text-lg text-black transition group-hover:bg-black/20">
                  →
                </span>
              </div>
            </Link>
          ))}
        </div>
      </section>

      <section className="mx-auto w-full max-w-6xl px-6 py-12">
        <div className="rounded-[32px] border border-border/60 bg-background/80 px-8 py-10">
          <div
            data-scroll-reveal
            data-reveal-state="hidden"
            className={`flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between ${scrollRevealBaseClass}`}
            style={{ transitionDelay: "0ms" }}
          >
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
                접수 프로세스
              </p>
              <h2 className="font-display mt-3 text-3xl text-foreground">
                심의는 4단계로 진행됩니다
              </h2>
              <p className="mt-3 max-w-xl text-sm text-muted-foreground">
                상품/방송국 패키지 선택부터 결제 확인까지 흐름을 간단하게 설계했습니다.
              </p>
            </div>
          </div>

          <div className="mt-8 grid grid-cols-2 gap-4 md:grid-cols-4">
            {["패키지 선택", "신청서 업로드", "결제하기", "접수 완료"].map((label, index) => (
              <div
                key={label}
                data-scroll-reveal
                data-reveal-state="hidden"
                style={{ transitionDelay: `${120 + index * 120}ms` }}
                className={`rounded-2xl border p-4 ${scrollRevealBaseClass} ${processStepTones[index] ?? "border-border/60 bg-card/70 text-foreground"
                  }`}
              >
                <p className="text-xs font-semibold uppercase tracking-[0.2em] opacity-80">
                  STEP {String(index + 1).padStart(2, "0")}
                </p>
                <p className="mt-2 text-sm font-semibold">{label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
