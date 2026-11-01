"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";

import { TrackLookupForm } from "@/features/track/track-lookup-form";
import { TrackLookupSelector } from "@/features/track/track-lookup-selector";

function TrackModeContent({ guest }: { guest: boolean }) {
  return (
    <div>
      <h1 className="font-display break-keep text-balance text-2xl font-black sm:text-3xl text-foreground">
        {guest ? "비회원 진행/결과 조회" : "조회 방식을 선택하세요"}
      </h1>
      {guest ? (
        <div className="mt-8 rounded-[10px] border-2 border-[#111111] bg-card p-5 shadow-[5px_5px_0_#111111] dark:border-[#f2cf27] dark:shadow-[5px_5px_0_#f2cf27]">
          <TrackLookupForm />
        </div>
      ) : (
        <TrackLookupSelector />
      )}
    </div>
  );
}

function TrackModeFromQuery() {
  return <TrackModeContent guest={useSearchParams().get("mode") === "guest"} />;
}

/** The lookup page is static: `?mode=guest` is read in the browser, the chooser is prerendered. */
export function TrackModeSwitch() {
  return (
    <Suspense fallback={<TrackModeContent guest={false} />}>
      <TrackModeFromQuery />
    </Suspense>
  );
}
