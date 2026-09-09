"use client";

import * as React from "react";

import {
  getKaraokeRecommendationFileUrlAction,
  getKaraokeRequestFileUrlAction,
} from "@/features/karaoke/actions";

export function KaraokeFileButton({
  kind,
  targetId,
  label = "파일 확인",
}: {
  kind: "request" | "recommendation";
  targetId: string;
  label?: string;
}) {
  const [isLoading, setIsLoading] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [fileUrl, setFileUrl] = React.useState<string | null>(null);

  const handleClick = async () => {
    if (isLoading) return;
    setIsLoading(true);
    setErrorMessage(null);
    setFileUrl(null);
    // Reserve the tab during the click so browsers do not block an async popup.
    let preview: Window | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      preview = window.open("about:blank", "_blank");
      if (preview) preview.opener = null;
      const result = await Promise.race([
        kind === "request"
          ? getKaraokeRequestFileUrlAction({ requestId: targetId })
          : getKaraokeRecommendationFileUrlAction({ recommendationId: targetId }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("파일 조회 응답이 지연되고 있습니다. 다시 시도해주세요.")), 20_000);
        }),
      ]);
      if (result.error || !result.url) throw new Error(result.error || "파일 주소를 확인할 수 없습니다.");
      if (preview && !preview.closed) preview.location.replace(result.url);
      else setFileUrl(result.url);
    } catch (error) {
      preview?.close();
      setErrorMessage(error instanceof Error ? error.message : "파일을 불러오지 못했습니다. 다시 시도해주세요.");
    } finally {
      if (timer) clearTimeout(timer);
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={isLoading}
        className="rounded-full border border-border/70 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.2em] text-foreground transition hover:border-foreground disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isLoading ? "확인 중" : label}
      </button>
      {fileUrl && <a href={fileUrl} target="_blank" rel="noopener noreferrer" className="text-xs font-semibold underline">파일 열기</a>}
      {errorMessage && (
        <span role="alert" className="text-[11px] text-red-500">{errorMessage}</span>
      )}
    </div>
  );
}
