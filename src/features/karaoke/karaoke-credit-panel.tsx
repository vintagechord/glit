"use client";

import * as React from "react";

import { createKaraokePromotionRecommendationAction } from "@/features/karaoke/actions";
import { safeRandomUUID } from "@/lib/uuid";

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
};

type UploadState = {
  name: string;
  progress: number;
  status: "idle" | "uploading" | "done" | "error";
  path?: string;
};

const isExternalUrl = (value?: string | null): value is string =>
  Boolean(value && /^https?:\/\//i.test(value));

const getPromotionTargets = (promotion: PromotionSummary) =>
  [promotion.tj_enabled ? "태진" : null, promotion.ky_enabled ? "금영" : null]
    .filter(Boolean)
    .map(String);

const getPromotionLink = (promotion: PromotionSummary) =>
  promotion.reference_url ?? promotion.submission?.melon_url ?? null;

export function KaraokeCreditPanel({
  userId,
  promotions,
  creditBalance = 0,
}: {
  userId?: string | null;
  promotions: PromotionSummary[];
  creditBalance?: number;
}) {
  const [promotionId, setPromotionId] = React.useState("");
  const [recommendationFile, setRecommendationFile] =
    React.useState<File | null>(null);
  const [recommendationUpload, setRecommendationUpload] =
    React.useState<UploadState>({
      name: "",
      progress: 0,
      status: "idle",
    });
  const [notice, setNotice] = React.useState<{ error?: string; message?: string }>(
    {},
  );
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (!promotionId && promotions.length > 0) {
      setPromotionId(promotions[0].id);
    }
  }, [promotionId, promotions]);

  const selectedPromotion = promotions.find(
    (promotion) => promotion.id === promotionId,
  );
  const promotionStream =
    promotions.length > 0 ? [...promotions, ...promotions] : [];

  const onFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files?.[0] ?? null;
    if (!selected) {
      setRecommendationFile(null);
      setRecommendationUpload({ name: "", progress: 0, status: "idle" });
      return;
    }
    setNotice({});
    setRecommendationFile(selected);
    setRecommendationUpload({ name: selected.name, progress: 0, status: "idle" });
  };

  const uploadWithProgress = async (signedUrl: string, selected: File) => {
    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.upload.onprogress = (event) => {
        if (!event.lengthComputable) return;
        const percent = Math.round((event.loaded / event.total) * 100);
        setRecommendationUpload((prev) => ({ ...prev, progress: percent }));
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve();
        } else {
          reject(new Error("Upload failed"));
        }
      };
      xhr.onerror = () => reject(new Error("Upload failed"));
      xhr.open("PUT", signedUrl);
      if (selected.type) {
        xhr.setRequestHeader("Content-Type", selected.type);
      }
      xhr.send(selected);
    });
  };

  const createSignedUpload = async (file: File) => {
    if (!userId) {
      throw new Error("User required");
    }
    const response = await fetch("/api/uploads/presign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        submissionId: promotionId || safeRandomUUID(),
        filename: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
        guestToken: undefined,
        scope: "karaoke_recommendation",
      }),
    });
    if (!response.ok) {
      throw new Error("Upload url creation failed");
    }
    return (await response.json()) as { uploadUrl: string; objectKey: string };
  };

  const handleSubmit = async () => {
    if (!userId) {
      setNotice({ error: "로그인 후 추천에 참여할 수 있습니다." });
      return;
    }
    if (!promotionId) {
      setNotice({ error: "추천할 곡을 선택해주세요." });
      return;
    }

    setIsSubmitting(true);
    setNotice({});
    try {
      let proofPath: string | undefined;
      if (recommendationFile) {
        setRecommendationUpload((prev) => ({ ...prev, status: "uploading" }));

        let signedUrl: string;
        let path: string;
        try {
          const uploadData = await createSignedUpload(recommendationFile);
          signedUrl = uploadData.uploadUrl;
          path = uploadData.objectKey;
        } catch {
          setRecommendationUpload((prev) => ({ ...prev, status: "error" }));
          setNotice({ error: "인증샷 업로드 URL 생성 실패" });
          return;
        }

        await uploadWithProgress(signedUrl, recommendationFile);
        setRecommendationUpload((prev) => ({ ...prev, status: "done", progress: 100 }));
        proofPath = path;
      }

      const result = await createKaraokePromotionRecommendationAction({
        promotionId,
        proofPath,
      });

      if (result.error) {
        setNotice({ error: result.error });
        return;
      }

      setNotice({ message: result.message });
      setRecommendationFile(null);
      setRecommendationUpload({ name: "", progress: 0, status: "idle" });
    } catch {
      setNotice({ error: "추천 처리 중 오류가 발생했습니다." });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-[28px] border border-border/60 bg-card/80 p-6 text-sm text-muted-foreground">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
          크레딧 적립하기
        </p>
        <p className="mt-3 text-sm">
          추천 요청된 곡을 태진/금영에 추천한 뒤 인증샷을 제출하면 크레딧이
          적립됩니다.
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          내 보유 크레딧 {creditBalance} · 추천 노출은 10크레딧부터 시작됩니다.
        </p>
      </div>

      <div className="rounded-[28px] border border-border/60 bg-card/80 p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
          추천 요청 보드
        </p>
        <p className="mt-3 text-xs text-muted-foreground">
          노출 크레딧이 높은 곡이 상단에 표시됩니다.
        </p>
        <div className="mt-4">
          {promotions.length > 0 ? (
            <div className="overflow-hidden">
              <div className="flex w-max gap-4 animate-marquee hover:[animation-play-state:paused]">
                {promotionStream.map((promotion, index) => {
                  const isSelected = promotion.id === promotionId;
                  const title = promotion.submission?.title ?? "제목 미입력";
                  const artist =
                    promotion.submission?.artist_name ?? "아티스트 미입력";
                  const targets = getPromotionTargets(promotion);
                  const link = getPromotionLink(promotion);
                  return (
                    <button
                      key={`${promotion.id}-${index}`}
                      type="button"
                      onClick={() => {
                        setPromotionId(promotion.id);
                        if (isExternalUrl(link)) {
                          window.open(link, "_blank", "noopener,noreferrer");
                        }
                      }}
                      className={`group flex min-w-[260px] flex-col overflow-hidden rounded-3xl border px-4 py-4 text-left transition ${
                        isSelected
                          ? "border-foreground bg-foreground text-background"
                          : "border-border/60 bg-background text-foreground hover:border-foreground"
                      }`}
                    >
                      <div className="relative overflow-hidden rounded-2xl border border-white/70 bg-gradient-to-br from-[#dff1ff] via-white to-[#f3eaff] px-4 py-5 text-slate-900">
                        <div className="absolute inset-0 opacity-50">
                          <div className="absolute -left-8 top-2 h-16 w-16 rounded-full bg-white/70 blur-xl" />
                          <div className="absolute -right-6 bottom-[-18px] h-20 w-20 rounded-full bg-white/60 blur-2xl" />
                        </div>
                        <div className="relative flex items-start justify-between">
                          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white/90 text-lg font-semibold text-slate-700 shadow-[0_12px_30px_rgba(15,23,42,0.12)]">
                            {(title.trim() || "O").slice(0, 1)}
                          </div>
                          <div className="flex flex-col items-end gap-1">
                            {targets.map((target) => (
                              <span
                                key={`${promotion.id}-${target}-${index}`}
                                className="rounded-full bg-slate-900 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-white"
                              >
                                {target}
                              </span>
                            ))}
                          </div>
                        </div>
                        <p className="mt-4 text-sm font-semibold">{title}</p>
                        <p className="mt-1 text-xs text-slate-700">{artist}</p>
                      </div>
                      <div className="mt-3 flex items-center justify-between text-xs">
                        <span className="font-semibold">
                          노출 {promotion.credits_balance} 크레딧
                        </span>
                        <span className="text-[11px] text-muted-foreground">
                          {targets.length > 0 ? targets.join(" · ") : "미선택"}
                        </span>
                      </div>
                      <span
                        className={`mt-3 inline-flex w-fit items-center rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] ${
                          isSelected
                            ? "border-background/60 text-background"
                            : "border-border/70 text-foreground group-hover:border-foreground"
                        }`}
                      >
                        {isExternalUrl(link) ? "추천 링크 열기" : "링크 준비중"}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              추천 가능한 곡이 없습니다.
            </p>
          )}
        </div>
      </div>

      <div className="rounded-[28px] border border-border/60 bg-card/80 p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
          추천 인증 제출
        </p>
        {!userId && (
          <p className="mt-3 text-xs text-muted-foreground">
            로그인 후 추천 참여가 가능합니다.
          </p>
        )}
        <div className="mt-4 space-y-3">
          <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            추천할 곡 선택
          </label>
          {selectedPromotion ? (
            <div className="rounded-2xl border border-border/60 bg-background/70 px-4 py-3 text-sm text-foreground">
              <p className="font-semibold">
                {selectedPromotion.submission?.title ?? "제목 미입력"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {selectedPromotion.submission?.artist_name ?? "아티스트 미입력"} ·{" "}
                {getPromotionTargets(selectedPromotion).join(" · ") || "미선택"}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                현재 노출 크레딧 {selectedPromotion.credits_balance} · 최소{" "}
                {selectedPromotion.credits_required} 크레딧 필요
              </p>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              추천할 곡을 선택해주세요.
            </p>
          )}
        </div>

        <div className="mt-4 space-y-3">
          <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            추천 인증샷 (선택)
          </label>
          <input
            type="file"
            accept="image/*"
            onChange={onFileChange}
            disabled={!userId}
            className="w-full rounded-2xl border border-dashed border-border/70 bg-background/60 px-4 py-6 text-sm text-muted-foreground disabled:cursor-not-allowed"
          />
          {recommendationUpload.name && (
            <div className="rounded-2xl border border-border/60 bg-background/70 px-4 py-3 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-foreground">
                  {recommendationUpload.name}
                </span>
                <span className="text-muted-foreground">
                  {recommendationUpload.status === "done"
                    ? "완료"
                    : recommendationUpload.status === "uploading"
                      ? "업로드 중"
                      : recommendationUpload.status === "error"
                        ? "실패"
                        : "대기"}
                </span>
              </div>
              <div className="mt-2 h-1.5 w-full rounded-full bg-muted">
                <div
                  className="h-1.5 rounded-full bg-foreground transition-all"
                  style={{ width: `${recommendationUpload.progress}%` }}
                />
              </div>
            </div>
          )}
        </div>

        {notice.error && (
          <div className="mt-4 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs text-red-600">
            {notice.error}
          </div>
        )}
        {notice.message && (
          <div className="mt-4 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-xs text-emerald-600">
            {notice.message}
          </div>
        )}

        <button
          type="button"
          onClick={handleSubmit}
          disabled={isSubmitting || !userId}
          className="mt-4 w-full rounded-full bg-foreground px-6 py-3 text-xs font-semibold uppercase tracking-[0.2em] text-background transition hover:-translate-y-0.5 hover:bg-foreground/90 disabled:cursor-not-allowed disabled:bg-muted"
        >
          추천 인증 제출
        </button>
      </div>
    </div>
  );
}
