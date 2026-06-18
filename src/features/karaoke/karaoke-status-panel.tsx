"use client";

import * as React from "react";

import { KaraokeFileButton } from "@/features/karaoke/karaoke-file-button";
import { formatDateTime } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";

type KaraokeRequest = {
  id: string;
  title: string;
  artist: string | null;
  file_path?: string | null;
  // 크레딧 운영 보류: 추천 공개 상태 숨김
  // recommendation_public?: boolean | null;
  status: string;
  created_at: string;
  updated_at?: string | null;
};

const steps = [
  { key: "REQUESTED", label: "접수" },
  { key: "IN_REVIEW", label: "추천중" },
  { key: "COMPLETED", label: "등록 결과" },
];

const statusLabelMap: Record<string, string> = {
  REQUESTED: "접수",
  IN_REVIEW: "추천중",
  COMPLETED: "등록 완료",
};

export function KaraokeStatusPanel({
  userId,
  initialRequests,
}: {
  userId?: string | null;
  initialRequests: KaraokeRequest[];
}) {
  const supabase = React.useMemo(
    () => (userId ? createClient() : null),
    [userId],
  );
  const [requests, setRequests] = React.useState<KaraokeRequest[]>(
    initialRequests ?? [],
  );

  const fetchLatest = React.useCallback(async () => {
    if (!supabase || !userId) return;
    const { data } = await supabase
      .from("karaoke_requests")
      .select("id, title, artist, file_path, status, created_at, updated_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (data) {
      setRequests(data);
    }
  }, [supabase, userId]);

  React.useEffect(() => {
    if (!supabase || !userId) return;
    const channel = supabase
      .channel(`karaoke-status-${userId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "karaoke_requests",
          filter: `user_id=eq.${userId}`,
        },
        fetchLatest,
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchLatest, supabase, userId]);

  if (!userId) {
    return (
      <div className="rounded-[28px] border border-border/60 bg-card/80 p-6 text-sm text-muted-foreground">
        로그인 후 진행상황을 확인할 수 있습니다.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-[28px] border border-border/60 bg-card/80 p-6 text-sm text-muted-foreground">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
          진행상황
        </p>
        <p className="mt-3 text-sm">
          노래방 등록 요청 진행상황은 실시간으로 업데이트됩니다.
        </p>
      </div>

      {requests.length > 0 ? (
        requests.map((request) => {
          const currentIndex = steps.findIndex(
            (step) => step.key === request.status,
          );
          return (
            <div
              key={request.id}
              className="rounded-[28px] border border-border/60 bg-card/80 p-6"
            >
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h3 className="text-lg font-semibold text-foreground">
                    {request.title}
                  </h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {request.artist ?? "아티스트 미입력"} ·{" "}
                    {formatDateTime(request.created_at)}
                  </p>
                </div>
                <span className="rounded-full border border-border/70 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-foreground">
                  {statusLabelMap[request.status] ?? request.status}
                </span>
              </div>
              {/* 크레딧 운영 보류: 추천 공개 상태 배지 숨김
              <p className="mt-3 inline-flex rounded-full border border-border/70 px-3 py-1 text-xs font-semibold text-muted-foreground">
                추천 요청 {request.recommendation_public ? "공개" : "비공개"}
              </p>
              */}
              <div className="mt-4 grid gap-3 md:grid-cols-3">
                {steps.map((step, index) => {
                  const active = index <= currentIndex;
                  return (
                    <div
                      key={step.key}
                      className={`rounded-2xl border px-4 py-3 text-center text-xs font-semibold uppercase tracking-[0.2em] ${
                        active
                          ? "border-foreground bg-foreground text-background"
                          : "border-border/60 bg-background text-muted-foreground"
                      }`}
                    >
                      {step.label}
                    </div>
                  );
                })}
              </div>
              {request.file_path && (
                <div className="mt-4">
                  <KaraokeFileButton
                    kind="request"
                    targetId={request.id}
                    label="첨부파일 확인"
                  />
                </div>
              )}
            </div>
          );
        })
      ) : (
        <div className="rounded-[28px] border border-dashed border-border/60 bg-background/70 p-6 text-xs text-muted-foreground">
          아직 접수된 노래방 등록 요청이 없습니다.
        </div>
      )}
    </div>
  );
}
