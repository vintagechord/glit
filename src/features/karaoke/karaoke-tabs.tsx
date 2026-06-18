"use client";

import * as React from "react";

// 크레딧 운영 보류: 크레딧 적립 패널 연결 숨김
// import { KaraokeCreditPanel } from "@/features/karaoke/karaoke-credit-panel";
import { KaraokeForm } from "@/features/karaoke/karaoke-form";
import { KaraokeStatusPanel } from "@/features/karaoke/karaoke-status-panel";

/*
크레딧 운영 보류: 추천 공개/적립 탭 재개 시 복구
type PromotionSummary = {
  id: string;
  credits_balance: number;
  credits_required: number;
  tj_enabled: boolean;
  ky_enabled: boolean;
  reference_url: string | null;
  submission?: {
    title?: string | null;
    artist_name?: string | null;
    melon_url?: string | null;
  } | null;
  request?: {
    title?: string | null;
    artist?: string | null;
    recommendation_public?: boolean | null;
  } | null;
};
*/

type KaraokeRequest = {
  id: string;
  title: string;
  artist: string | null;
  file_path?: string | null;
  recommendation_public?: boolean | null;
  status: string;
  created_at: string;
  updated_at?: string | null;
};

type TabKey = "apply" | "status";

export function KaraokeTabs({
  userId,
  // 크레딧 운영 보류: 추천 공개/적립 탭 재개 시 복구
  // promotions,
  // creditBalance,
  requests,
}: {
  userId?: string | null;
  // promotions: PromotionSummary[];
  // creditBalance: number;
  requests: KaraokeRequest[];
}) {
  const [tab, setTab] = React.useState<TabKey>("apply");

  return (
    <div className="space-y-8">
      <div className="inline-flex flex-wrap items-center gap-2 text-xs font-black uppercase tracking-normal text-muted-foreground">
        <button
          type="button"
          onClick={() => setTab("apply")}
          className={`rounded-[8px] border-2 px-4 py-2 transition ${
            tab === "apply"
              ? "border-[#111111] bg-[#f2cf27] text-[#111111] shadow-[3px_3px_0_#111111] dark:border-[#f2cf27] dark:shadow-none"
              : "border-border bg-background hover:border-[#111111] hover:text-foreground dark:hover:border-[#f2cf27]"
          }`}
        >
          노래방 등록 신청하기
        </button>
        {/* 크레딧 운영 보류: 적립 탭 숨김
        <button
          type="button"
          onClick={() => setTab("credit")}
          className={`rounded-[8px] border-2 px-4 py-2 transition ${
            tab === "credit"
              ? "border-[#111111] bg-[#f2cf27] text-[#111111] shadow-[3px_3px_0_#111111] dark:border-[#f2cf27] dark:shadow-none"
              : "border-border bg-background hover:border-[#111111] hover:text-foreground dark:hover:border-[#f2cf27]"
          }`}
        >
          크레딧 적립하기
        </button>
        */}
        <button
          type="button"
          onClick={() => setTab("status")}
          className={`rounded-[8px] border-2 px-4 py-2 transition ${
            tab === "status"
              ? "border-[#111111] bg-[#f2cf27] text-[#111111] shadow-[3px_3px_0_#111111] dark:border-[#f2cf27] dark:shadow-none"
              : "border-border bg-background hover:border-[#111111] hover:text-foreground dark:hover:border-[#f2cf27]"
          }`}
        >
          진행상황
        </button>
      </div>

      {tab === "apply" && (
        <KaraokeForm userId={userId ?? null} />
      )}
      {/* 크레딧 운영 보류: 적립 패널 숨김
      {tab === "credit" && (
        <KaraokeCreditPanel
          userId={userId ?? null}
          promotions={promotions}
          creditBalance={creditBalance}
        />
      )}
      */}
      {tab === "status" && (
        <KaraokeStatusPanel
          userId={userId ?? null}
          initialRequests={requests}
        />
      )}
    </div>
  );
}
