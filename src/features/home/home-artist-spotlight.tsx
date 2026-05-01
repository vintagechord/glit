"use client";

import * as React from "react";

import { createClient } from "@/lib/supabase/client";

type SpotlightSubmission = {
  id: string;
  title: string | null;
  artist_name: string | null;
  type: string | null;
  release_date?: string | null;
  updated_at?: string | null;
};

type DashboardStatusResponse = {
  albumSubmissions?: Array<{
    id: string;
    title: string | null;
    artist_name?: string | null;
    status: string;
    updated_at: string;
    payment_status?: string | null;
  }>;
  albumStationsMap?: Record<string, Array<{ id: string }>>;
  error?: string;
};

const buildYouTubeQuery = (submission: SpotlightSubmission) => {
  const artist = submission.artist_name?.trim() || "artist";
  const title = submission.title?.trim() || "";
  const isReleased =
    submission.release_date != null &&
    submission.release_date.length > 0 &&
    new Date(submission.release_date).getTime() <= Date.now();
  const isMv = submission.type?.startsWith("MV");

  if (isReleased) {
    return isMv
      ? `${artist} ${title} official music video`
      : `${artist} ${title} official audio`;
  }

  return isMv ? `${artist} official music video` : `${artist} official audio`;
};

const buildEmbedUrl = (query: string) =>
  `https://www.youtube-nocookie.com/embed?listType=search&list=${encodeURIComponent(query)}&rel=0&modestbranding=1`;

const buildSearchUrl = (query: string) =>
  `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;

export function HomeArtistSpotlight({
  frameHeight = 224,
}: {
  frameHeight?: number;
}) {
  const [submission, setSubmission] = React.useState<SpotlightSubmission | null>(null);
  const [shouldRender, setShouldRender] = React.useState(false);

  React.useEffect(() => {
    const supabase = createClient();
    let active = true;

    const load = async () => {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!active) return;
        if (!user) {
          setSubmission(null);
          setShouldRender(false);
          return;
        }

        const dashboardRes = await fetch("/api/dashboard/status", {
          cache: "no-store",
        });
        const dashboardJson = (await dashboardRes
          .json()
          .catch(() => null)) as DashboardStatusResponse | null;

        if (!active) return;

        const primaryAlbum = dashboardJson?.albumSubmissions?.[0] ?? null;
        const stationCount = primaryAlbum
          ? (dashboardJson?.albumStationsMap?.[primaryAlbum.id] ?? []).length
          : 0;

        if (
          !dashboardRes.ok ||
          dashboardJson?.error ||
          !primaryAlbum ||
          stationCount <= 5
        ) {
          setSubmission(null);
          setShouldRender(false);
          return;
        }

        const { data, error } = await supabase
          .from("submissions")
          .select("id, title, artist_name, type, release_date, updated_at")
          .eq("id", primaryAlbum.id)
          .maybeSingle();

        if (!active) return;
        if (error) {
          console.error("[HomeArtistSpotlight] failed to load submission", error);
          setSubmission(null);
          setShouldRender(false);
          return;
        }

        setSubmission(
          (data as SpotlightSubmission | null) ?? {
            id: primaryAlbum.id,
            title: primaryAlbum.title,
            artist_name: primaryAlbum.artist_name ?? null,
            type: "ALBUM",
            updated_at: primaryAlbum.updated_at,
          },
        );
        setShouldRender(true);
      } catch (error) {
        if (!active) return;
        console.error("[HomeArtistSpotlight] failed to initialize", error);
        setSubmission(null);
        setShouldRender(false);
      }
    };

    void load();

    return () => {
      active = false;
    };
  }, []);

  if (!shouldRender || !submission) return null;

  const query = buildYouTubeQuery(submission);
  const embedUrl = buildEmbedUrl(query);
  const searchUrl = buildSearchUrl(query);
  const typeLabel = submission.type?.startsWith("MV") ? "뮤직비디오" : "음원";

  return (
    <div className="mt-4 overflow-hidden rounded-[10px] border-2 border-[#111111] bg-card p-4 shadow-[5px_5px_0_#111111] dark:border-[#f2cf27] dark:shadow-[5px_5px_0_#f2cf27]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase tracking-normal text-muted-foreground">
            YouTube Spotlight
          </p>
          <h3 className="mt-2 text-base font-black text-foreground">
            {submission.artist_name || "아티스트"} · {submission.title || "최신 접수곡"}
          </h3>
        </div>
        <a
          href={searchUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex shrink-0 rounded-[8px] border-2 border-[#111111] bg-[#f2cf27] px-4 py-2 text-xs font-black uppercase tracking-normal text-[#111111] transition hover:bg-white dark:border-[#f2cf27]"
        >
          유튜브 열기
        </a>
      </div>

      <div className="mt-4 overflow-hidden rounded-[8px] border-2 border-border bg-black">
        <div className="w-full" style={{ height: `${frameHeight}px` }}>
          <iframe
            title={`${submission.artist_name || "artist"} youtube spotlight`}
            src={embedUrl}
            className="h-full w-full"
            loading="lazy"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            referrerPolicy="strict-origin-when-cross-origin"
            allowFullScreen
          />
        </div>
      </div>
    </div>
  );
}
