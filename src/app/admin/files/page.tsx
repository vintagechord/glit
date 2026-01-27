"use client";

import React from "react";

import { PendingOverlay } from "@/components/ui/pending-overlay";

type UploadedAttachment = {
  id?: string | null;
  kind: string;
  name: string;
  size: number;
  createdAt?: string | null;
};

const kindOptions = [
  { value: "MV_RATING_FILE_ALL", label: "등급분류 · 전체관람가 (MV)" },
  { value: "MV_RATING_FILE_12", label: "등급분류 · 12세 이상 (MV)" },
  { value: "MV_RATING_FILE_15", label: "등급분류 · 15세 이상 (MV)" },
  { value: "MV_RATING_FILE_18", label: "등급분류 · 18세 이상 (MV)" },
  { value: "MV_RATING_FILE_REJECT", label: "등급분류 · 심의 불가 (MV)" },
  { value: "MV_RESULT_FILE", label: "심의 결과 파일 (MV)" },
  { value: "MV_LABEL_GUIDE_FILE", label: "표기 방법 가이드 (MV)" },
];

export default function AdminFilesPage() {
  const [submissionId, setSubmissionId] = React.useState("");
  const [kind, setKind] = React.useState(kindOptions[0]?.value ?? "MV_RATING_FILE");
  const [files, setFiles] = React.useState<FileList | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [isUploading, setIsUploading] = React.useState(false);
  const [uploaded, setUploaded] = React.useState<UploadedAttachment[]>([]);

  const handleSelectFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files;
    setFiles(selected ?? null);
  };

  const resetForm = () => {
    setFile(null);
    setNotice(null);
  };

  const handleUpload = async () => {
    if (!submissionId.trim()) {
      setNotice("Submission ID를 입력하세요.");
      return;
    }
    if (!files || files.length === 0) {
      setNotice("업로드할 파일을 선택하세요.");
      return;
    }

    setIsUploading(true);
    setNotice(null);
    try {
      for (const fileItem of Array.from(files)) {
        const form = new FormData();
        form.append("submissionId", submissionId.trim());
        form.append("filename", fileItem.name);
        form.append("mimeType", fileItem.type || "application/octet-stream");
        form.append("sizeBytes", String(fileItem.size));
        form.append("file", fileItem);

        const directRes = await fetch("/api/uploads/direct", {
          method: "POST",
          body: form,
        });
        const directJson = (await directRes.json().catch(() => ({}))) as {
          objectKey?: string;
          error?: string;
        };
        if (!directRes.ok || !directJson.objectKey) {
          throw new Error(directJson.error || `직접 업로드 실패 (status ${directRes.status})`);
        }

        const saveRes = await fetch("/api/admin/submission-files", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            submissionId: submissionId.trim(),
            kind,
            objectKey: directJson.objectKey,
            filename: fileItem.name,
            mimeType: fileItem.type || "application/octet-stream",
            sizeBytes: fileItem.size,
          }),
        });
        const saveJson = (await saveRes.json().catch(() => null)) as { error?: string; attachmentId?: string };
        if (!saveRes.ok || saveJson?.error) {
          throw new Error(saveJson?.error || `파일 정보 저장 실패 (status ${saveRes.status})`);
        }

        setUploaded((prev) => [
          {
            id: saveJson.attachmentId,
            kind,
            name: fileItem.name,
            size: fileItem.size,
            createdAt: new Date().toISOString(),
          },
          ...prev,
        ]);
      }
      resetForm();
      setNotice("업로드 완료되었습니다.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "업로드에 실패했습니다.");
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-10">
      <PendingOverlay show={isUploading} label="파일 업로드 중..." />
      <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
        관리자 · 파일 업로드
      </p>
      <h1 className="font-display mt-2 text-2xl text-foreground">심의 결과/가이드 파일 업로드</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        심의 결과 파일, 등급분류 파일, 표기 가이드 파일을 개별 접수 건에 연결합니다. B2 스토리지에 저장되며
        사용자 상세 화면에서 다운로드할 수 있습니다.
      </p>

      <div className="mt-6 grid gap-4 rounded-3xl border border-border/70 bg-card/80 p-6">
        <label className="space-y-2">
          <span className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            Submission ID (UUID)
          </span>
          <input
            value={submissionId}
            onChange={(event) => setSubmissionId(event.target.value)}
            placeholder="예: 123e4567-e89b-12d3-a456-426614174000"
            className="w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-foreground"
          />
        </label>

        <label className="space-y-2">
          <span className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            파일 종류
          </span>
          <select
            value={kind}
            onChange={(event) => setKind(event.target.value)}
            className="w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-foreground"
          >
            {kindOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-2">
          <span className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            파일 선택
          </span>
          <input
            type="file"
            multiple
            onChange={handleSelectFile}
            className="block w-full text-sm text-foreground file:mr-3 file:rounded-xl file:border file:border-border/70 file:bg-background file:px-4 file:py-2 file:text-xs file:font-semibold file:uppercase file:tracking-[0.2em] file:text-foreground hover:file:border-foreground"
          />
          {files && files.length > 0 ? (
            <p className="text-xs text-muted-foreground">
              {Array.from(files)
                .map((item) => `${item.name} · ${Math.round(item.size / 1024).toLocaleString()} KB`)
                .join(", ")}
            </p>
          ) : null}
        </label>

        {notice ? (
          <div className="rounded-2xl border border-amber-200/70 bg-amber-50/80 px-4 py-3 text-sm font-semibold text-amber-900">
            {notice}
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
            disabled={isUploading}
            className="rounded-full bg-foreground px-5 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-background transition hover:-translate-y-0.5 hover:bg-amber-200 hover:text-slate-900 disabled:cursor-not-allowed disabled:bg-muted"
          >
            업로드
          </button>
        </div>
      </div>

      {uploaded.length > 0 ? (
        <div className="mt-8 rounded-3xl border border-border/70 bg-card/80 p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
            최근 업로드
          </p>
          <div className="mt-4 space-y-3 text-sm">
            {uploaded.map((item, idx) => (
              <div
                key={`${item.id ?? idx}-${item.name}`}
                className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-border/60 bg-background/60 px-4 py-3"
              >
                <div className="space-y-1">
                  <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                    {item.kind}
                  </p>
                  <p className="font-semibold text-foreground">{item.name}</p>
                </div>
                <p className="text-xs text-muted-foreground">
                  {Math.round(item.size / 1024)} KB
                  {item.createdAt ? ` · ${new Date(item.createdAt).toLocaleString()}` : ""}
                </p>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
