"use client";

import React from "react";
import { Download, FileCheck2, UploadCloud } from "lucide-react";

import { AdminSaveToast } from "@/components/admin/save-toast";
import { PendingOverlay } from "@/components/ui/pending-overlay";
import { downloadEndpointFile } from "@/lib/browser-download";

type MvSubmissionItem = {
  id: string;
  label: string;
  artistName: string | null;
  albumTitle: string | null;
  status: string | null;
  paymentStatus: string | null;
  resultStatus: string | null;
  resultNotifiedAt: string | null;
  updatedAt: string | null;
  createdAt: string | null;
  rating: string | null;
  ratingLabel: string | null;
  certificate: {
    objectKey: string;
    originalName?: string | null;
    mimeType?: string | null;
    sizeBytes?: number | null;
    uploadedAt?: string | null;
  } | null;
};

type SubmissionsPayload = {
  submissions?: MvSubmissionItem[];
  error?: string;
};

type CertificateUploadResponse = {
  error?: string;
  certificate?: {
    objectKey: string;
    originalName: string;
    uploadedAt: string;
  };
};

const statusLabelMap: Record<string, string> = {
  SUBMITTED: "접수 완료",
  PRE_REVIEW: "사전 검토",
  WAITING_PAYMENT: "결제 대기",
  IN_PROGRESS: "진행 중",
  RESULT_READY: "결과 준비",
  COMPLETED: "결과 통보 완료",
};

const paymentLabelMap: Record<string, string> = {
  UNPAID: "미결제",
  PAYMENT_PENDING: "결제 대기",
  PAID: "결제 완료",
  REFUNDED: "환불",
};

const formatDateTime = (value?: string | null) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("ko-KR", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
};

const formatBytes = (value?: number | null) => {
  if (!value || value <= 0) return "";
  if (value < 1024) return `${value}B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)}KB`;
  return `${(value / 1024 / 1024).toFixed(1)}MB`;
};

const isAllowedCertificateFile = (file: File) => {
  const mimeType = file.type.toLowerCase();
  const filename = file.name.toLowerCase();
  return (
    ["application/pdf", "image/png", "image/jpeg"].includes(mimeType) ||
    /\.(pdf|png|jpe?g)$/.test(filename)
  );
};

const inferCertificateMimeType = (file: File) => {
  const mimeType = file.type.toLowerCase();
  if (["application/pdf", "image/png", "image/jpeg"].includes(mimeType)) {
    return mimeType;
  }
  const filename = file.name.toLowerCase();
  if (filename.endsWith(".pdf")) return "application/pdf";
  if (filename.endsWith(".png")) return "image/png";
  if (filename.endsWith(".jpg") || filename.endsWith(".jpeg")) return "image/jpeg";
  return file.type || "application/octet-stream";
};

const ratingDownloadFallback = (rating?: string | null) => {
  switch (rating) {
    case "ALL":
      return "onside-mv-rating-all.png";
    case "12":
      return "onside-mv-rating-12.png";
    case "15":
      return "onside-mv-rating-15.png";
    case "18":
    case "19":
      return "onside-mv-rating-19.png";
    default:
      return "onside-mv-rating-image.png";
  }
};

export default function AdminFilesPage() {
  const [submissions, setSubmissions] = React.useState<MvSubmissionItem[]>([]);
  const [selectedSubmissionId, setSelectedSubmissionId] = React.useState("");
  const [file, setFile] = React.useState<File | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isUploading, setIsUploading] = React.useState(false);
  const [isDownloadingRating, setIsDownloadingRating] = React.useState(false);
  const [isDownloadingCertificate, setIsDownloadingCertificate] = React.useState(false);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [savePopup, setSavePopup] = React.useState<{
    id: number;
    message: string;
  } | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);

  const selectedSubmission = React.useMemo(
    () => submissions.find((item) => item.id === selectedSubmissionId) ?? null,
    [selectedSubmissionId, submissions],
  );

  const loadSubmissions = React.useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/mv-submissions", {
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => null)) as SubmissionsPayload | null;
      if (!response.ok || payload?.error) {
        throw new Error(payload?.error || "뮤직비디오 접수 목록을 불러오지 못했습니다.");
      }
      const nextItems = payload?.submissions ?? [];
      setSubmissions(nextItems);
      setSelectedSubmissionId((current) => {
        if (current && nextItems.some((item) => item.id === current)) return current;
        return nextItems[0]?.id ?? "";
      });
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "뮤직비디오 접수 목록을 불러오지 못했습니다.",
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void loadSubmissions();
  }, [loadSubmissions]);

  const resetForm = () => {
    setNotice(null);
    setError(null);
    setFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleSelectFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    setFile(event.target.files?.[0] ?? null);
    setNotice(null);
    setError(null);
  };

  const handleRatingDownload = async () => {
    if (!selectedSubmission?.rating) {
      setError("선택된 뮤직비디오의 등급이 아직 설정되지 않았습니다.");
      return;
    }

    setIsDownloadingRating(true);
    setNotice(null);
    setError(null);
    try {
      await downloadEndpointFile(
        `/api/admin/mv-rating-assets/download?rating=${encodeURIComponent(
          selectedSubmission.rating,
        )}`,
        ratingDownloadFallback(selectedSubmission.rating),
      );
    } catch (downloadError) {
      setError(
        downloadError instanceof Error
          ? downloadError.message
          : "등급 이미지를 다운로드하지 못했습니다.",
      );
    } finally {
      setIsDownloadingRating(false);
    }
  };

  const handleCertificateDownload = async () => {
    if (!selectedSubmission?.certificate?.objectKey) {
      setError("등록된 필증이 없습니다.");
      return;
    }

    setIsDownloadingCertificate(true);
    setNotice(null);
    setError(null);
    try {
      await downloadEndpointFile(
        `/api/admin/submissions/${selectedSubmission.id}/mv-certificate`,
        selectedSubmission.certificate.originalName || "onside-mv-certificate.pdf",
      );
    } catch (downloadError) {
      setError(
        downloadError instanceof Error
          ? downloadError.message
          : "필증을 다운로드하지 못했습니다.",
      );
    } finally {
      setIsDownloadingCertificate(false);
    }
  };

  const handleUpload = async () => {
    if (!selectedSubmission) {
      setError("필증을 업로드할 뮤직비디오 접수를 선택하세요.");
      return;
    }
    if (!file) {
      setError("업로드할 필증 파일을 선택하세요.");
      return;
    }
    if (!isAllowedCertificateFile(file)) {
      setError("필증은 PDF, PNG, JPG 파일만 업로드할 수 있습니다.");
      return;
    }
    const maxSize = 20 * 1024 * 1024;
    if (file.size > maxSize) {
      setError("필증 파일 크기는 20MB 이하만 허용됩니다.");
      return;
    }

    setIsUploading(true);
    setNotice(null);
    setError(null);
    try {
      const form = new FormData();
      form.append("filename", file.name);
      form.append("mimeType", inferCertificateMimeType(file));
      form.append("sizeBytes", String(file.size));
      form.append("file", file);

      const response = await fetch(
        `/api/admin/submissions/${selectedSubmission.id}/certificate`,
        {
          method: "POST",
          body: form,
        },
      );
      const payload = (await response.json().catch(() => null)) as
        | CertificateUploadResponse
        | null;
      if (!response.ok || payload?.error) {
        throw new Error(payload?.error || "필증 업로드에 실패했습니다.");
      }
      if (!payload?.certificate) {
        throw new Error("필증 업로드 결과를 확인하지 못했습니다.");
      }

      setSubmissions((prev) =>
        prev.map((item) =>
          item.id === selectedSubmission.id
            ? {
                ...item,
                certificate: {
                  objectKey: payload.certificate!.objectKey,
                  originalName: payload.certificate!.originalName,
                  mimeType: inferCertificateMimeType(file),
                  sizeBytes: file.size,
                  uploadedAt: payload.certificate!.uploadedAt,
                },
              }
            : item,
        ),
      );
      setFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      const successMessage = "필증을 업로드했습니다.";
      setNotice(successMessage);
      setSavePopup({ id: Date.now(), message: successMessage });
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "필증 업로드에 실패했습니다.");
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-10">
      {savePopup ? (
        <AdminSaveToast key={savePopup.id} message={savePopup.message} />
      ) : null}
      <PendingOverlay
        show={isUploading || isDownloadingRating || isDownloadingCertificate}
        label={
          isUploading
            ? "필증 업로드 중..."
            : isDownloadingCertificate
              ? "필증 다운로드 중..."
              : "등급 이미지 다운로드 중..."
        }
      />
      <h1 className="font-display text-2xl text-foreground">
        뮤직비디오 필증 업로드
      </h1>
      <details className="mt-2 text-xs text-muted-foreground">
        <summary className="cursor-pointer font-semibold text-foreground">
          사용자 제공 파일
        </summary>
        <p className="mt-2 max-w-3xl leading-5">
          결과 등급에 맞는 이미지와 가이드는 자동 제공되며, 업로드한 필증도 결과
          화면에서 함께 다운로드할 수 있습니다.
        </p>
      </details>

      <div className="mt-6 grid gap-5 rounded-[28px] border border-border/70 bg-card/80 p-6">
        <label className="space-y-2">
          <span className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            뮤직비디오 접수 선택
          </span>
          <select
            value={selectedSubmissionId}
            onChange={(event) => {
              setSelectedSubmissionId(event.target.value);
              resetForm();
            }}
            disabled={isLoading || submissions.length === 0}
            className="w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm font-semibold text-foreground outline-none transition focus:border-foreground disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isLoading ? (
              <option value="">접수 목록을 불러오는 중입니다.</option>
            ) : submissions.length > 0 ? (
              submissions.map((submission) => (
                <option key={submission.id} value={submission.id}>
                  {submission.label}
                </option>
              ))
            ) : (
              <option value="">접수된 온라인 뮤직비디오 심의가 없습니다.</option>
            )}
          </select>
        </label>

        {selectedSubmission ? (
          <div className="rounded-[18px] border border-border/60 bg-background/70 p-4">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-lg font-black text-foreground">
                  {selectedSubmission.label}
                </p>
                <details className="mt-1 text-xs text-muted-foreground">
                  <summary className="cursor-pointer font-semibold">
                    ID {selectedSubmission.id.slice(0, 8)}
                  </summary>
                  <p className="mt-1 break-all">{selectedSubmission.id}</p>
                </details>
              </div>
              <span className="rounded-full border border-[#1556a4]/30 bg-[#1556a4]/10 px-3 py-1 text-xs font-black text-[#1556a4]">
                {selectedSubmission.ratingLabel ?? "등급 미설정"}
              </span>
            </div>

            <div className="mt-4 grid gap-3 text-sm sm:grid-cols-4">
              <div className="rounded-2xl border border-border/60 bg-card/70 px-3 py-2">
                <p className="text-[11px] font-black uppercase tracking-normal text-muted-foreground">
                  접수 상태
                </p>
                <p className="mt-1 font-semibold text-foreground">
                  {statusLabelMap[selectedSubmission.status ?? ""] ??
                    selectedSubmission.status ??
                    "-"}
                </p>
              </div>
              <div className="rounded-2xl border border-border/60 bg-card/70 px-3 py-2">
                <p className="text-[11px] font-black uppercase tracking-normal text-muted-foreground">
                  결제
                </p>
                <p className="mt-1 font-semibold text-foreground">
                  {paymentLabelMap[selectedSubmission.paymentStatus ?? ""] ??
                    selectedSubmission.paymentStatus ??
                    "-"}
                </p>
              </div>
              <div className="rounded-2xl border border-border/60 bg-card/70 px-3 py-2">
                <p className="text-[11px] font-black uppercase tracking-normal text-muted-foreground">
                  결과 통보
                </p>
                <p className="mt-1 font-semibold text-foreground">
                  {formatDateTime(selectedSubmission.resultNotifiedAt)}
                </p>
              </div>
              <div className="rounded-2xl border border-border/60 bg-card/70 px-3 py-2">
                <p className="text-[11px] font-black uppercase tracking-normal text-muted-foreground">
                  현재 필증
                </p>
                <p className="mt-1 truncate font-semibold text-foreground">
                  {selectedSubmission.certificate?.originalName ?? "미업로드"}
                </p>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleRatingDownload}
                disabled={!selectedSubmission.rating || isDownloadingRating}
                className="inline-flex items-center gap-2 rounded-full bg-[#1556a4] px-4 py-2 text-xs font-black text-white transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0"
              >
                <Download className="h-4 w-4" aria-hidden="true" />
                등급 이미지 다운로드
              </button>
              {selectedSubmission.certificate?.objectKey ? (
                <button
                  type="button"
                  onClick={handleCertificateDownload}
                  disabled={isDownloadingCertificate}
                  className="inline-flex items-center gap-2 rounded-full border border-border/70 px-4 py-2 text-xs font-black text-foreground transition hover:border-foreground"
                >
                  <FileCheck2 className="h-4 w-4" aria-hidden="true" />
                  현재 필증 다운로드
                </button>
              ) : null}
            </div>
          </div>
        ) : null}

        <label className="space-y-2">
          <span className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            필증 파일 선택
          </span>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf,image/png,image/jpeg,.pdf,.png,.jpg,.jpeg"
            onChange={handleSelectFile}
            disabled={!selectedSubmission || isUploading}
            className="block w-full text-sm text-foreground file:mr-3 file:rounded-xl file:border file:border-border/70 file:bg-background file:px-4 file:py-2 file:text-xs file:font-semibold file:uppercase file:tracking-[0.2em] file:text-foreground hover:file:border-foreground disabled:cursor-not-allowed disabled:opacity-60"
          />
          {file ? (
            <p className="text-xs text-muted-foreground">
              {file.name} · {formatBytes(file.size)}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              PDF, PNG, JPG 형식의 영등위 필증을 업로드하세요.
            </p>
          )}
        </label>

        {notice ? (
          <div className="rounded-2xl border border-emerald-200/70 bg-emerald-50/80 px-4 py-3 text-sm font-semibold text-emerald-800">
            {notice}
          </div>
        ) : null}
        {error ? (
          <div className="rounded-2xl border border-rose-200/70 bg-rose-50/80 px-4 py-3 text-sm font-semibold text-rose-700">
            {error}
          </div>
        ) : null}

        <div className="flex flex-wrap justify-end gap-3">
          <button
            type="button"
            onClick={resetForm}
            className="rounded-full border border-border/70 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-foreground transition hover:border-foreground hover:bg-foreground/5"
            disabled={isUploading}
          >
            초기화
          </button>
          <button
            type="button"
            onClick={handleUpload}
            disabled={isUploading || !selectedSubmission || !file}
            className="inline-flex items-center gap-2 rounded-full bg-foreground px-5 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-background transition hover:-translate-y-0.5 hover:bg-[#f6d64a] hover:text-black disabled:cursor-not-allowed disabled:bg-muted disabled:hover:translate-y-0"
          >
            <UploadCloud className="h-4 w-4" aria-hidden="true" />
            {isUploading ? "업로드 중" : "필증 업로드"}
          </button>
        </div>
      </div>
    </div>
  );
}
