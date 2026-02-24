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

const kindOptions = [{ value: "MV_RESULT_FILE", label: "심의 결과 파일 (MV)" }];

type Mode = "attach" | "free";

export default function AdminFilesPage() {
  const [mode, setMode] = React.useState<Mode>("attach");
  const [submissionId, setSubmissionId] = React.useState("");
  const [label, setLabel] = React.useState("");
  const [kind, setKind] = React.useState(kindOptions[0]?.value ?? "MV_RATING_FILE_ALL");
  const [files, setFiles] = React.useState<FileList | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [isUploading, setIsUploading] = React.useState(false);
  const [uploaded, setUploaded] = React.useState<UploadedAttachment[]>([]);
  const [freeUploaded, setFreeUploaded] = React.useState<
    { objectKey: string; url?: string | null }[]
  >([]);

  const handleSelectFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    setFiles(event.target.files ?? null);
  };

  const resetForm = () => {
    setNotice(null);
    setFiles(null);
    setLabel("");
  };

  const handleUpload = async () => {
    if (mode === "attach" && !submissionId.trim()) {
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
      if (mode === "attach") {
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
      } else {
        const uploadedFree: { objectKey: string; url?: string | null }[] = [];
        for (const fileItem of Array.from(files)) {
          const form = new FormData();
          form.append("filename", fileItem.name);
          form.append("mimeType", fileItem.type || "application/octet-stream");
          form.append("sizeBytes", String(fileItem.size));
          if (label.trim()) form.append("label", label.trim());
          form.append("file", fileItem);

          const freeRes = await fetch("/api/admin/uploads/free", {
            method: "POST",
            body: form,
          });
          const freeJson = (await freeRes.json().catch(() => ({}))) as {
            objectKey?: string;
            error?: string;
          };
          if (!freeRes.ok || !freeJson.objectKey) {
            throw new Error(freeJson.error || `자유 업로드 실패 (status ${freeRes.status})`);
          }

          let signedUrl: string | null = null;
          try {
            const presignRes = await fetch("/api/admin/files/presign", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ objectKey: freeJson.objectKey }),
            });
            const presignJson = (await presignRes.json().catch(() => null)) as { url?: string; error?: string };
            if (presignRes.ok && presignJson?.url) signedUrl = presignJson.url;
          } catch {
            signedUrl = null;
          }

          uploadedFree.push({ objectKey: freeJson.objectKey, url: signedUrl });
        }
        setFreeUploaded((prev) => [...uploadedFree, ...prev]);
        resetForm();
        setNotice("자유 업로드 완료. objectKey를 복사해 접수에 연결하거나 결과에 사용하세요.");
      }
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
        심의 결과 파일을 접수에 바로 연결하거나, 자유 업로드로 B2에 저장해둔 뒤 필요 시 objectKey를 연결할 수
        있습니다. 등급 이미지와 가이드는 공용 리소스로 관리되며 여기서 올리지 않습니다.
      </p>

      <div className="mt-4 flex flex-wrap gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
        <button
          type="button"
          onClick={() => setMode("attach")}
          className={`rounded-full px-4 py-2 transition ${
            mode === "attach"
              ? "bg-foreground text-background"
              : "border border-border/70 text-foreground hover:border-foreground"
          }`}
        >
          접수 연결 업로드
        </button>
        <button
          type="button"
          onClick={() => setMode("free")}
          className={`rounded-full px-4 py-2 transition ${
            mode === "free"
              ? "bg-foreground text-background"
              : "border border-border/70 text-foreground hover:border-foreground"
          }`}
        >
          자유 업로드
        </button>
      </div>

      <div className="mt-6 grid gap-4 rounded-3xl border border-border/70 bg-card/80 p-6">
        {mode === "attach" ? (
          <>
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
          </>
        ) : (
          <label className="space-y-2">
            <span className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              라벨 (선택)
            </span>
            <input
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder="예: mv-rating-18, guide, result 등"
              className="w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-foreground"
            />
          </label>
        )}

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
          <div className="rounded-2xl border border-[#f6d64a] bg-[#f6d64a] px-4 py-3 text-sm font-semibold text-black">
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
            className="rounded-full bg-foreground px-5 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-background transition hover:-translate-y-0.5 hover:bg-[#f6d64a] hover:text-black disabled:cursor-not-allowed disabled:bg-muted"
          >
            업로드
          </button>
        </div>
      </div>

      {uploaded.length > 0 ? (
        <div className="mt-8 rounded-3xl border border-border/70 bg-card/80 p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
            최근 업로드 (접수 연결)
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

      {freeUploaded.length > 0 ? (
        <div className="mt-8 rounded-3xl border border-border/70 bg-card/80 p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
            자유 업로드 결과 (objectKey 복사 후 연결)
          </p>
          <div className="mt-4 space-y-3 text-sm">
            {freeUploaded.map((item, idx) => (
              <div
                key={`${item.objectKey}-${idx}`}
                className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border/60 bg-background/60 px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate font-semibold text-foreground">{item.objectKey}</p>
                  {item.url ? (
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-foreground underline hover:text-amber-300"
                    >
                      10분짜리 다운로드 링크 열기
                    </a>
                  ) : (
                    <p className="text-xs text-muted-foreground">사인 URL 생성 실패 시 직접 생성 필요</p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => navigator.clipboard.writeText(item.objectKey)}
                  className="rounded-full border border-border/70 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-foreground transition hover:border-foreground hover:bg-foreground/5"
                >
                  key 복사
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
