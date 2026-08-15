"use client";

import * as React from "react";
import { ImageUp, RotateCcw } from "lucide-react";

import { AdminSaveToast } from "@/components/admin/save-toast";
import { showCenteredConfirm } from "@/lib/centered-dialog";

type RatingAsset = {
  code: "ALL" | "12" | "15" | "19";
  label: string;
  imageUrl: string;
  isCustom: boolean;
  originalName?: string | null;
  sizeBytes?: number | null;
  updatedAt?: string | null;
};

type AssetsPayload = {
  assets?: RatingAsset[];
  error?: string;
};

const formatBytes = (value?: number | null) => {
  if (!value || value <= 0) return null;
  if (value < 1024) return `${value}B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)}KB`;
  return `${(value / 1024 / 1024).toFixed(1)}MB`;
};

const formatDateTime = (value?: string | null) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString("ko-KR", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
};

export function MvRatingAssetsManager() {
  const [assets, setAssets] = React.useState<RatingAsset[]>([]);
  const [selectedFiles, setSelectedFiles] = React.useState<
    Partial<Record<RatingAsset["code"], File>>
  >({});
  const [loading, setLoading] = React.useState(true);
  const [workingCode, setWorkingCode] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [savePopup, setSavePopup] = React.useState<{
    id: number;
    message: string;
  } | null>(null);

  const loadAssets = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/mv-rating-assets", {
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => null)) as AssetsPayload | null;
      if (!response.ok || payload?.error) {
        throw new Error(payload?.error || "연령등급 이미지를 불러오지 못했습니다.");
      }
      setAssets(payload?.assets ?? []);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "연령등급 이미지를 불러오지 못했습니다.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void loadAssets();
  }, [loadAssets]);

  const handleFileChange = (
    code: RatingAsset["code"],
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0] ?? null;
    setNotice(null);
    setError(null);
    setSelectedFiles((prev) => {
      const next = { ...prev };
      if (file) {
        next[code] = file;
      } else {
        delete next[code];
      }
      return next;
    });
  };

  const handleUpload = async (asset: RatingAsset) => {
    const file = selectedFiles[asset.code];
    if (!file) {
      setError("업로드할 PNG 파일을 선택하세요.");
      return;
    }
    if (file.type && file.type !== "image/png") {
      setError("PNG 파일만 업로드할 수 있습니다.");
      return;
    }
    if (!file.name.toLowerCase().endsWith(".png")) {
      setError("PNG 파일만 업로드할 수 있습니다.");
      return;
    }

    setWorkingCode(asset.code);
    setNotice(null);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("rating", asset.code);
      formData.append("filename", file.name);
      formData.append("mimeType", file.type || "image/png");
      formData.append("sizeBytes", String(file.size));
      formData.append("file", file);

      const response = await fetch("/api/admin/mv-rating-assets", {
        method: "POST",
        body: formData,
      });
      const payload = (await response.json().catch(() => null)) as AssetsPayload | null;
      if (!response.ok || payload?.error) {
        throw new Error(payload?.error || "업로드에 실패했습니다.");
      }

      setAssets(payload?.assets ?? []);
      setSelectedFiles((prev) => {
        const next = { ...prev };
        delete next[asset.code];
        return next;
      });
      const successMessage = `${asset.label} 이미지가 저장되었습니다.`;
      setNotice(successMessage);
      setSavePopup({ id: Date.now(), message: successMessage });
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "업로드에 실패했습니다.");
    } finally {
      setWorkingCode(null);
    }
  };

  const handleReset = async (asset: RatingAsset) => {
    if (!asset.isCustom) return;
    if (
      !(await showCenteredConfirm(
        `${asset.label} 이미지를 기본 이미지로 되돌릴까요?`,
      ))
    ) {
      return;
    }

    setWorkingCode(asset.code);
    setNotice(null);
    setError(null);
    try {
      const response = await fetch("/api/admin/mv-rating-assets", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rating: asset.code }),
      });
      const payload = (await response.json().catch(() => null)) as AssetsPayload | null;
      if (!response.ok || payload?.error) {
        throw new Error(payload?.error || "삭제에 실패했습니다.");
      }

      setAssets(payload?.assets ?? []);
      const successMessage = `${asset.label} 이미지를 기본값으로 되돌렸습니다.`;
      setNotice(successMessage);
      setSavePopup({ id: Date.now(), message: successMessage });
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "삭제에 실패했습니다.");
    } finally {
      setWorkingCode(null);
    }
  };

  return (
    <div className="space-y-4">
      {savePopup ? (
        <AdminSaveToast key={savePopup.id} message={savePopup.message} />
      ) : null}
      <div>
        <h2 className="text-lg font-semibold text-foreground">
          뮤직비디오 연령등급 이미지
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          등급별 PNG를 관리합니다. 미등록 등급은 기본 이미지를 사용합니다.
        </p>
      </div>

      {loading ? (
        <div className="rounded-2xl border border-dashed border-border/60 bg-background/70 px-4 py-6 text-sm text-muted-foreground">
          연령등급 이미지를 불러오는 중입니다.
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {assets.map((asset) => {
            const selectedFile = selectedFiles[asset.code] ?? null;
            const isWorking = workingCode === asset.code;
            const uploadedAt = formatDateTime(asset.updatedAt);
            const fileSize = formatBytes(asset.sizeBytes);

            return (
              <div
                key={asset.code}
                className="rounded-[18px] border border-border/70 bg-background/70 p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-black text-foreground">
                      {asset.label}
                    </p>
                    <p className="mt-1 text-[11px] font-semibold uppercase tracking-normal text-muted-foreground">
                      {asset.isCustom ? "관리자 업로드" : "기본 이미지"}
                    </p>
                  </div>
                  <span className="rounded-[6px] border border-border bg-card px-2 py-1 text-[11px] font-black text-foreground">
                    {asset.code}
                  </span>
                </div>

                <div className="mt-4 flex aspect-square items-center justify-center overflow-hidden rounded-[10px] border-2 border-[#111111] bg-white p-3 dark:border-[#f2cf27]">
                  <div
                    role="img"
                    aria-label={`${asset.label} 등급 이미지`}
                    className="h-full w-full bg-contain bg-center bg-no-repeat"
                    style={{ backgroundImage: `url(${asset.imageUrl})` }}
                  />
                </div>

                <div className="mt-3 min-h-[42px] text-[11px] leading-5 text-muted-foreground">
                  {asset.originalName ? (
                    <p className="truncate font-semibold text-foreground">
                      {asset.originalName}
                    </p>
                  ) : (
                    <p>기본 첨부 이미지 사용 중</p>
                  )}
                  {uploadedAt || fileSize ? (
                    <p>
                      {[uploadedAt, fileSize].filter(Boolean).join(" · ")}
                    </p>
                  ) : null}
                </div>

                <label className="mt-3 block">
                  <span className="sr-only">{asset.label} PNG 선택</span>
                  <input
                    type="file"
                    accept="image/png,.png"
                    disabled={isWorking}
                    onChange={(event) => handleFileChange(asset.code, event)}
                    className="block w-full text-[11px] text-muted-foreground file:mr-3 file:rounded-full file:border-0 file:bg-muted file:px-3 file:py-2 file:text-[11px] file:font-black file:text-foreground"
                  />
                </label>
                {selectedFile ? (
                  <p className="mt-2 truncate text-[11px] text-muted-foreground">
                    선택됨: {selectedFile.name}
                  </p>
                ) : null}

                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => handleUpload(asset)}
                    disabled={isWorking || !selectedFile}
                    className="inline-flex items-center gap-1.5 rounded-full bg-foreground px-3 py-2 text-[11px] font-black text-background transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0"
                  >
                    <ImageUp className="h-3.5 w-3.5" aria-hidden="true" />
                    {isWorking ? "처리 중" : "업로드"}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleReset(asset)}
                    disabled={isWorking || !asset.isCustom}
                    className="inline-flex items-center gap-1.5 rounded-full border border-border/70 px-3 py-2 text-[11px] font-black text-foreground transition hover:border-foreground disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                    삭제
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {notice ? (
        <div className="rounded-2xl border border-emerald-200/70 bg-emerald-50/80 px-4 py-3 text-xs text-emerald-800">
          {notice}
        </div>
      ) : null}
      {error ? (
        <div className="rounded-2xl border border-rose-200/70 bg-rose-50/80 px-4 py-3 text-xs text-rose-700">
          {error}
        </div>
      ) : null}
    </div>
  );
}
