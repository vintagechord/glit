"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { APP_CONFIG } from "@/lib/config";
import { formatCurrency } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";

import {
  saveAlbumSubmissionAction,
  type SubmissionActionState,
} from "./actions";

type StationOption = {
  id: string;
  name: string;
  code: string;
};

type PackageOption = {
  id: string;
  name: string;
  stationCount: number;
  priceKrw: number;
  description?: string | null;
  stations: StationOption[];
};

type TrackInput = {
  trackTitle: string;
  featuring: string;
  composer: string;
  lyricist: string;
  notes: string;
  isTitle: boolean;
};

type UploadItem = {
  name: string;
  size: number;
  progress: number;
  status: "pending" | "uploading" | "done" | "error";
  path?: string;
  mime?: string;
};

type UploadResult = {
  path: string;
  originalName: string;
  mime?: string;
  size: number;
};

const initialTrack: TrackInput = {
  trackTitle: "",
  featuring: "",
  composer: "",
  lyricist: "",
  notes: "",
  isTitle: false,
};

const steps = [
  "패키지 선택",
  "신청서/파일 업로드",
  "옵션 선택",
  "결제 안내",
  "접수 완료",
];

const uploadMaxMb = Number(process.env.NEXT_PUBLIC_UPLOAD_MAX_MB ?? "200");
const uploadMaxBytes = uploadMaxMb * 1024 * 1024;

export function AlbumWizard({
  packages,
  userId,
}: {
  packages: PackageOption[];
  userId: string;
}) {
  const router = useRouter();
  const supabase = React.useMemo(() => createClient(), []);
  const [step, setStep] = React.useState(1);
  const [selectedPackage, setSelectedPackage] =
    React.useState<PackageOption | null>(packages[0] ?? null);
  const [tracks, setTracks] = React.useState<TrackInput[]>([initialTrack]);
  const [title, setTitle] = React.useState("");
  const [artistName, setArtistName] = React.useState("");
  const [releaseDate, setReleaseDate] = React.useState("");
  const [genre, setGenre] = React.useState("");
  const [preReviewRequested, setPreReviewRequested] = React.useState(false);
  const [karaokeRequested, setKaraokeRequested] = React.useState(false);
  const [bankDepositorName, setBankDepositorName] = React.useState("");
  const [files, setFiles] = React.useState<File[]>([]);
  const [uploads, setUploads] = React.useState<UploadItem[]>([]);
  const [uploadedFiles, setUploadedFiles] = React.useState<UploadResult[]>([]);
  const [fileDigest, setFileDigest] = React.useState("");
  const [isSaving, setIsSaving] = React.useState(false);
  const [notice, setNotice] = React.useState<SubmissionActionState>({});
  const [completionId, setCompletionId] = React.useState<string | null>(null);
  const submissionIdRef = React.useRef<string>();

  if (!submissionIdRef.current) {
    submissionIdRef.current = crypto.randomUUID();
  }

  const submissionId = submissionIdRef.current;

  const stepLabels = (
    <div className="grid gap-3 md:grid-cols-5">
      {steps.map((label, index) => {
        const active = index + 1 <= step;
        return (
          <div
            key={label}
            className={`rounded-2xl border px-4 py-3 text-xs font-semibold uppercase tracking-[0.2em] ${
              active
                ? "border-foreground bg-foreground text-background"
                : "border-border/60 bg-background text-muted-foreground"
            }`}
          >
            STEP {String(index + 1).padStart(2, "0")}
            <p className="mt-2 text-[11px] font-medium tracking-normal">
              {label}
            </p>
          </div>
        );
      })}
    </div>
  );

  const updateTrack = <K extends keyof TrackInput>(
    index: number,
    field: K,
    value: TrackInput[K],
  ) => {
    setTracks((prev) =>
      prev.map((track, idx) =>
        idx === index ? { ...track, [field]: value } : track,
      ),
    );
  };

  const toggleTitleTrack = (index: number) => {
    setTracks((prev) =>
      prev.map((track, idx) => ({
        ...track,
        isTitle: idx === index,
      })),
    );
  };

  const addTrack = () => {
    setTracks((prev) => [...prev, { ...initialTrack }]);
  };

  const removeTrack = (index: number) => {
    setTracks((prev) => prev.filter((_, idx) => idx !== index));
  };

  const onFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(event.target.files ?? []);
    const allowedTypes = new Set([
      "audio/mpeg",
      "audio/mp3",
      "audio/wav",
      "audio/x-wav",
    ]);
    const filtered = selected.filter((file) => {
      if (file.size > uploadMaxBytes) {
        setNotice({ error: `파일 용량은 ${uploadMaxMb}MB 이하만 가능합니다.` });
        return false;
      }
      if (file.type && !allowedTypes.has(file.type)) {
        setNotice({ error: "WAV 또는 MP3 파일만 업로드할 수 있습니다." });
        return false;
      }
      if (!file.type) {
        const lowerName = file.name.toLowerCase();
        if (!lowerName.endsWith(".wav") && !lowerName.endsWith(".mp3")) {
          setNotice({ error: "WAV 또는 MP3 파일만 업로드할 수 있습니다." });
          return false;
        }
      }
      return true;
    });
    setNotice({});
    setFiles(filtered);
    setUploads(
      filtered.map((file) => ({
        name: file.name,
        size: file.size,
        progress: 0,
        status: "pending",
        mime: file.type,
      })),
    );
  };

  const uploadWithProgress = async (
    signedUrl: string,
    file: File,
    onProgress: (percent: number) => void,
  ) => {
    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.upload.onprogress = (event) => {
        if (!event.lengthComputable) return;
        const percent = Math.round((event.loaded / event.total) * 100);
        onProgress(percent);
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
      if (file.type) {
        xhr.setRequestHeader("Content-Type", file.type);
      }
      xhr.send(file);
    });
  };

  const uploadFiles = async () => {
    if (files.length === 0) return [];

    const digest = files
      .map((file) => `${file.name}-${file.size}-${file.lastModified}`)
      .join("|");
    if (digest === fileDigest && uploadedFiles.length > 0) {
      return uploadedFiles;
    }

    const results: UploadResult[] = [];
    const nextUploads = [...uploads];

    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      const fileName = `${Date.now()}-${file.name.replace(/\s+/g, "_")}`;
      const path = `${userId}/${submissionId}/audio/${fileName}`;

      nextUploads[index] = {
        ...nextUploads[index],
        status: "uploading",
      };
      setUploads([...nextUploads]);

      const { data, error } = await supabase.storage
        .from("submissions")
        .createSignedUploadUrl(path, { upsert: true });

      if (error || !data) {
        nextUploads[index] = {
          ...nextUploads[index],
          status: "error",
        };
        setUploads([...nextUploads]);
        throw new Error("업로드 URL 생성 실패");
      }

      await uploadWithProgress(data.signedUrl, file, (progress) => {
        nextUploads[index] = {
          ...nextUploads[index],
          progress,
        };
        setUploads([...nextUploads]);
      });

      nextUploads[index] = {
        ...nextUploads[index],
        status: "done",
        progress: 100,
        path: data.path,
      };
      setUploads([...nextUploads]);

      results.push({
        path: data.path,
        originalName: file.name,
        mime: file.type || undefined,
        size: file.size,
      });
    }

    setUploadedFiles(results);
    setFileDigest(digest);
    return results;
  };

  const handleSave = async (status: "DRAFT" | "SUBMITTED") => {
    if (!selectedPackage) {
      setNotice({ error: "패키지를 선택해주세요." });
      return;
    }
    if (!title || !artistName) {
      setNotice({ error: "곡 제목과 아티스트명을 입력해주세요." });
      return;
    }
    if (tracks.some((track) => !track.trackTitle)) {
      setNotice({ error: "모든 트랙명을 입력해주세요." });
      return;
    }
    if (status === "SUBMITTED" && !bankDepositorName.trim()) {
      setNotice({ error: "입금자명을 입력해주세요." });
      return;
    }

    setIsSaving(true);
    setNotice({});
    try {
      const uploaded = await uploadFiles();
      const result = await saveAlbumSubmissionAction({
        submissionId,
        packageId: selectedPackage.id,
        title,
        artistName,
        releaseDate: releaseDate || undefined,
        genre: genre || undefined,
        preReviewRequested,
        karaokeRequested,
        bankDepositorName:
          status === "SUBMITTED" ? bankDepositorName.trim() : undefined,
        status,
        tracks,
        files: uploaded,
      });

      if (result.error) {
        setNotice({ error: result.error });
        return;
      }

      if (status === "SUBMITTED" && result.submissionId) {
        setCompletionId(result.submissionId);
        setStep(5);
        return;
      }

      setNotice({ submissionId: result.submissionId });
    } catch {
      setNotice({ error: "저장 중 오류가 발생했습니다." });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-8">
      {stepLabels}

      {step === 1 && (
        <div className="space-y-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
                STEP 01
              </p>
              <h2 className="font-display mt-2 text-2xl text-foreground">
                패키지를 선택하세요.
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                포함 방송국과 가격을 확인하고 선택할 수 있습니다.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setStep(2)}
              disabled={!selectedPackage}
              className="rounded-full bg-foreground px-5 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-background transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:bg-muted"
            >
              다음 단계
            </button>
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            {packages.map((pkg) => {
              const isActive = selectedPackage?.id === pkg.id;
              return (
                <button
                  key={pkg.id}
                  type="button"
                  onClick={() => setSelectedPackage(pkg)}
                  className={`text-left rounded-[28px] border p-6 transition ${
                    isActive
                      ? "border-foreground bg-foreground text-background"
                      : "border-border/60 bg-card/80 text-foreground hover:border-foreground"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.3em] opacity-70">
                        {pkg.stationCount}곳 패키지
                      </p>
                      <h3 className="mt-2 text-xl font-semibold">
                        {pkg.name}
                      </h3>
                    </div>
                    <span className="text-sm font-semibold">
                      {formatCurrency(pkg.priceKrw)}원
                    </span>
                  </div>
                  <p className="mt-3 text-xs opacity-70">{pkg.description}</p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {pkg.stations.map((station) => (
                      <span
                        key={station.id}
                        className={`rounded-full border px-3 py-1 text-[11px] uppercase tracking-[0.2em] ${
                          isActive
                            ? "border-background/30 text-background"
                            : "border-border/60 text-muted-foreground"
                        }`}
                      >
                        {station.name}
                      </span>
                    ))}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-8">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
                STEP 02
              </p>
              <h2 className="font-display mt-2 text-2xl text-foreground">
                신청서 정보를 입력하세요.
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                트랙 정보와 음원 파일을 업로드합니다.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="rounded-full border border-border/70 px-5 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-foreground transition hover:border-foreground"
              >
                이전 단계
              </button>
              <button
                type="button"
                onClick={() => setStep(3)}
                className="rounded-full bg-foreground px-5 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-background transition hover:-translate-y-0.5"
              >
                다음 단계
              </button>
            </div>
          </div>

          <div className="rounded-[28px] border border-border/60 bg-card/80 p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
              기본 정보
            </p>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                  곡 제목
                </label>
                <input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  className="w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-foreground"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                  아티스트명
                </label>
                <input
                  value={artistName}
                  onChange={(event) => setArtistName(event.target.value)}
                  className="w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-foreground"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                  발매일
                </label>
                <input
                  type="date"
                  value={releaseDate}
                  onChange={(event) => setReleaseDate(event.target.value)}
                  className="w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-foreground"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                  장르
                </label>
                <input
                  value={genre}
                  onChange={(event) => setGenre(event.target.value)}
                  className="w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-foreground"
                />
              </div>
            </div>
          </div>

          <div className="rounded-[28px] border border-border/60 bg-card/80 p-6">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
                트랙 정보
              </p>
              <button
                type="button"
                onClick={addTrack}
                className="rounded-full border border-border/70 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-foreground transition hover:border-foreground"
              >
                트랙 추가
              </button>
            </div>
            <div className="mt-5 space-y-5">
              {tracks.map((track, index) => (
                <div
                  key={`track-${index}`}
                  className="rounded-2xl border border-border/60 bg-background/70 p-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-foreground">
                      트랙 {index + 1}
                    </p>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={track.isTitle}
                          onChange={() => toggleTitleTrack(index)}
                          className="h-4 w-4 rounded border-border"
                        />
                        타이틀
                      </label>
                      {tracks.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeTrack(index)}
                          className="text-red-500"
                        >
                          삭제
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                        트랙명
                      </label>
                      <input
                        value={track.trackTitle}
                        onChange={(event) =>
                          updateTrack(index, "trackTitle", event.target.value)
                        }
                        className="w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-foreground"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                        피처링
                      </label>
                      <input
                        value={track.featuring}
                        onChange={(event) =>
                          updateTrack(index, "featuring", event.target.value)
                        }
                        className="w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-foreground"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                        작곡
                      </label>
                      <input
                        value={track.composer}
                        onChange={(event) =>
                          updateTrack(index, "composer", event.target.value)
                        }
                        className="w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-foreground"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                        작사
                      </label>
                      <input
                        value={track.lyricist}
                        onChange={(event) =>
                          updateTrack(index, "lyricist", event.target.value)
                        }
                        className="w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-foreground"
                      />
                    </div>
                    <div className="space-y-2 md:col-span-2">
                      <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                        특이사항
                      </label>
                      <input
                        value={track.notes}
                        onChange={(event) =>
                          updateTrack(index, "notes", event.target.value)
                        }
                        className="w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-foreground"
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-[28px] border border-border/60 bg-card/80 p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
              음원 파일 업로드
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              허용 형식: WAV/MP3 · 최대 {uploadMaxMb}MB
            </p>
            <div className="mt-4">
              <input
                type="file"
                multiple
                accept=".wav,.mp3,audio/*"
                onChange={onFileChange}
                className="w-full rounded-2xl border border-dashed border-border/70 bg-background/60 px-4 py-6 text-sm text-muted-foreground"
              />
            </div>
            <div className="mt-4 space-y-3">
              {uploads.map((upload) => (
                <div
                  key={upload.name}
                  className="rounded-2xl border border-border/60 bg-background/70 px-4 py-3 text-xs"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-foreground">
                      {upload.name}
                    </span>
                    <span className="text-muted-foreground">
                      {upload.status === "done"
                        ? "완료"
                        : upload.status === "uploading"
                          ? "업로드 중"
                          : upload.status === "error"
                            ? "실패"
                            : "대기"}
                    </span>
                  </div>
                  <div className="mt-2 h-1.5 w-full rounded-full bg-muted">
                    <div
                      className="h-1.5 rounded-full bg-foreground transition-all"
                      style={{ width: `${upload.progress}%` }}
                    />
                  </div>
                </div>
              ))}
              {uploads.length === 0 && (
                <div className="rounded-2xl border border-dashed border-border/60 bg-background/70 px-4 py-6 text-xs text-muted-foreground">
                  아직 선택된 파일이 없습니다.
                </div>
              )}
            </div>
          </div>

          {notice.error && (
            <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs text-red-600">
              {notice.error}
            </div>
          )}
          {notice.submissionId && (
            <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-xs text-emerald-600">
              임시 저장이 완료되었습니다.
            </div>
          )}

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => handleSave("DRAFT")}
              disabled={isSaving}
              className="rounded-full border border-border/70 px-6 py-3 text-xs font-semibold uppercase tracking-[0.2em] text-foreground transition hover:border-foreground disabled:cursor-not-allowed"
            >
              임시 저장
            </button>
            <button
              type="button"
              onClick={() => setStep(3)}
              className="rounded-full bg-foreground px-6 py-3 text-xs font-semibold uppercase tracking-[0.2em] text-background transition hover:-translate-y-0.5 hover:bg-foreground/90"
            >
              다음 단계
            </button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-8">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
                STEP 03
              </p>
              <h2 className="font-display mt-2 text-2xl text-foreground">
                추가 옵션을 선택하세요.
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                사전 검토와 노래방 등록 요청을 선택할 수 있습니다.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setStep(2)}
                className="rounded-full border border-border/70 px-5 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-foreground transition hover:border-foreground"
              >
                이전 단계
              </button>
              <button
                type="button"
                onClick={() => setStep(4)}
                className="rounded-full bg-foreground px-5 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-background transition hover:-translate-y-0.5"
              >
                다음 단계
              </button>
            </div>
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            <button
              type="button"
              onClick={() => setPreReviewRequested((prev) => !prev)}
              className={`rounded-[28px] border p-6 text-left transition ${
                preReviewRequested
                  ? "border-foreground bg-foreground text-background"
                  : "border-border/60 bg-card/80 text-foreground hover:border-foreground"
              }`}
            >
              <p className="text-xs font-semibold uppercase tracking-[0.3em] opacity-70">
                Pre-Review
              </p>
              <h3 className="mt-2 text-lg font-semibold">
                방송국 접수 전 사전 검토
              </h3>
              <p className="mt-2 text-xs opacity-70">
                {APP_CONFIG.preReviewPriceKrw > 0
                  ? `추가 비용 ${formatCurrency(
                      APP_CONFIG.preReviewPriceKrw,
                    )}원`
                  : "무료로 제공되는 옵션입니다."}
              </p>
            </button>
            <button
              type="button"
              onClick={() => setKaraokeRequested((prev) => !prev)}
              className={`rounded-[28px] border p-6 text-left transition ${
                karaokeRequested
                  ? "border-foreground bg-foreground text-background"
                  : "border-border/60 bg-card/80 text-foreground hover:border-foreground"
              }`}
            >
              <p className="text-xs font-semibold uppercase tracking-[0.3em] opacity-70">
                Karaoke
              </p>
              <h3 className="mt-2 text-lg font-semibold">노래방 등록 요청</h3>
              <p className="mt-2 text-xs opacity-70">
                신청 후 별도 담당자가 확인합니다.
              </p>
            </button>
          </div>

          <div className="rounded-[28px] border border-dashed border-border/60 bg-background/70 p-4 text-xs text-muted-foreground">
            가사 입력 또는 첨부 자료가 필요한 경우, 접수 완료 후 담당자가 별도
            연락드립니다.
          </div>
        </div>
      )}

      {step === 4 && (
        <div className="space-y-8">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
                STEP 04
              </p>
              <h2 className="font-display mt-2 text-2xl text-foreground">
                무통장 입금 안내
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                입금 정보를 확인한 뒤 입금자명을 입력해주세요.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setStep(3)}
              className="rounded-full border border-border/70 px-5 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-foreground transition hover:border-foreground"
            >
              이전 단계
            </button>
          </div>

          <div className="rounded-[28px] border border-border/60 bg-card/80 p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
              입금 계좌
            </p>
            <div className="mt-4 grid gap-4 text-sm text-foreground md:grid-cols-3">
              <div>
                <p className="text-xs text-muted-foreground">은행</p>
                <p className="mt-1 font-semibold">{APP_CONFIG.bankName}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">계좌번호</p>
                <p className="mt-1 font-semibold">{APP_CONFIG.bankAccount}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">예금주</p>
                <p className="mt-1 font-semibold">{APP_CONFIG.bankHolder}</p>
              </div>
            </div>
            <div className="mt-6 space-y-2">
              <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                입금자명
              </label>
              <input
                value={bankDepositorName}
                onChange={(event) => setBankDepositorName(event.target.value)}
                placeholder="입금자명을 입력해주세요."
                className="w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-foreground"
              />
            </div>
          </div>

          {notice.error && (
            <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs text-red-600">
              {notice.error}
            </div>
          )}

          <button
            type="button"
            onClick={() => handleSave("SUBMITTED")}
            disabled={isSaving}
            className="rounded-full bg-foreground px-6 py-3 text-xs font-semibold uppercase tracking-[0.2em] text-background transition hover:-translate-y-0.5 hover:bg-foreground/90 disabled:cursor-not-allowed disabled:bg-muted"
          >
            접수 완료 요청
          </button>
        </div>
      )}

      {step === 5 && (
        <div className="rounded-[32px] border border-border/60 bg-card/80 p-10 text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
            STEP 05
          </p>
          <h2 className="font-display mt-3 text-3xl text-foreground">
            접수 완료
          </h2>
          <p className="mt-3 text-sm text-muted-foreground">
            입금 확인 후 진행 상태가 업데이트됩니다.
          </p>
          {completionId && (
            <button
              type="button"
              onClick={() => router.push(`/dashboard/submissions/${completionId}`)}
              className="mt-6 rounded-full bg-foreground px-6 py-3 text-xs font-semibold uppercase tracking-[0.2em] text-background transition hover:-translate-y-0.5"
            >
              진행 상황 보기
            </button>
          )}
        </div>
      )}
    </div>
  );
}
