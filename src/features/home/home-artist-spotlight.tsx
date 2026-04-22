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

export function HomeArtistSpotlight() {
  const [submission, setSubmission] = React.useState<SpotlightSubmission | null>(null);
  const [loading, setLoading] = React.useState(true);

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
          setLoading(false);
          return;
        }

        const { data, error } = await supabase
          .from("submissions")
          .select("id, title, artist_name, type, release_date, updated_at")
          .eq("user_id", user.id)
          .order("updated_at", { ascending: false })
          .limit(1);

        if (!active) return;
        if (error) {
          console.error("[HomeArtistSpotlight] failed to load submission", error);
          setSubmission(null);
          setLoading(false);
          return;
        }

        setSubmission((data?.[0] as SpotlightSubmission | undefined) ?? null);
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    void load();

    return () => {
      active = false;
    };
  }, []);

  if (loading) {
    return (
      <div className="mt-5 overflow-hidden rounded-[28px] border border-black/8 bg-white/62 p-5 shadow-[0_16px_40px_rgba(0,0,0,0.08)] backdrop-blur-md dark:border-white/10 dark:bg-white/6 dark:shadow-none">
        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-muted-foreground">
          Artist Spotlight
        </p>
        <div className="mt-4 h-[260px] animate-pulse rounded-[24px] bg-black/5 dark:bg-white/8" />
      </div>
    );
  }

  if (!submission) {
    return (
      <div className="mt-5 overflow-hidden rounded-[28px] border border-black/8 bg-white/62 p-5 shadow-[0_16px_40px_rgba(0,0,0,0.08)] backdrop-blur-md dark:border-white/10 dark:bg-white/6 dark:shadow-none">
        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-muted-foreground">
          Artist Spotlight
        </p>
        <div className="mt-4 rounded-[24px] border border-dashed border-border/70 bg-background/70 px-5 py-10 text-center">
          <p className="text-sm font-semibold text-foreground">
            접수 내역이 생기면 최신 곡 기준으로 유튜브 스포트라이트가 표시됩니다.
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            공개 전 곡은 이전 공개작 기준으로, 공개된 곡은 현재 작품명 기준으로 자동 탐색합니다.
          </p>
        </div>
      </div>
    );
  }

  const query = buildYouTubeQuery(submission);
  const embedUrl = buildEmbedUrl(query);
  const searchUrl = buildSearchUrl(query);
  const typeLabel = submission.type?.startsWith("MV") ? "뮤직비디오" : "음원";

  return (
    <div className="mt-5 overflow-hidden rounded-[28px] border border-black/8 bg-white/62 p-5 shadow-[0_16px_40px_rgba(0,0,0,0.08)] backdrop-blur-md dark:border-white/10 dark:bg-white/6 dark:shadow-none">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-muted-foreground">
            Artist Spotlight
          </p>
          <h3 className="mt-2 text-lg font-semibold text-foreground">
            {submission.artist_name || "아티스트"} · {submission.title || "최신 접수곡"}
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            최신 접수 작품 기준 {typeLabel} 유튜브 검색 결과를 바로 확인합니다.
          </p>
        </div>
        <a
          href={searchUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex shrink-0 rounded-full border border-[#0071e3] px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-[#0071e3] transition hover:bg-[#0071e3] hover:text-white dark:border-[#2997ff] dark:text-[#8bc3ff] dark:hover:bg-[#2997ff] dark:hover:text-[#00101f]"
        >
          유튜브 열기
        </a>
      </div>

      <div className="mt-4 overflow-hidden rounded-[24px] border border-border/70 bg-black">
        <div className="aspect-video w-full">
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
