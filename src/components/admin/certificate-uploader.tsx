"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { AdminSaveToast } from "@/components/admin/save-toast";

type Props = {
  submissionId: string;
  currentObjectKey?: string | null;
  currentName?: string | null;
  currentUploadedAt?: string | null;
};

type CertificateUploadResponse = {
  error?: string;
  certificate?: {
    objectKey: string;
    originalName: string;
    uploadedAt: string;
  };
};

const normalizeDisplayFilename = (value?: string | null) => {
  const trimmed = value?.trim();
  if (!trimmed) return null;

  const likelyMojibake =
    /[\u0080-\u009F]/.test(trimmed) ||
    /(Ã.|Â.|á.|ì.|í.|ò.|ó.|ô.|õ.|ö.)/.test(trimmed);
  if (!likelyMojibake) return trimmed;

  try {
    const bytes = Uint8Array.from(trimmed, (char) => char.charCodeAt(0) & 0xff);
    const decoded = new TextDecoder("utf-8").decode(bytes).trim();
    return decoded || trimmed;
  } catch {
    return trimmed;
  }
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

export function CertificateUploader({
  submissionId,
  currentObjectKey,
  currentName,
  currentUploadedAt,
}: Props) {
  const [file, setFile] = React.useState<File | null>(null);
  const [currentFile, setCurrentFile] = React.useState({
    objectKey: currentObjectKey ?? null,
    name: normalizeDisplayFilename(currentName),
    uploadedAt: currentUploadedAt ?? null,
  });
  const [isUploading, setIsUploading] = React.useState(false);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [savePopup, setSavePopup] = React.useState<{
    id: number;
    message: string;
  } | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const router = useRouter();

  React.useEffect(() => {
    setCurrentFile({
      objectKey: currentObjectKey ?? null,
      name: normalizeDisplayFilename(currentName),
      uploadedAt: currentUploadedAt ?? null,
    });
  }, [currentObjectKey, currentName, currentUploadedAt]);

  const handleUpload = async () => {
    if (!file) {
      setNotice("업로드할 파일을 선택하세요.");
      return;
    }
    if (!isAllowedCertificateFile(file)) {
      setNotice("PDF, PNG, JPG만 업로드할 수 있습니다.");
      return;
    }
    const maxSize = 20 * 1024 * 1024;
    if (file.size > maxSize) {
      setNotice("파일 크기는 20MB 이하만 허용됩니다.");
      return;
    }
    setIsUploading(true);
    setNotice(null);
    try {
      const form = new FormData();
      form.append("filename", file.name);
      form.append("mimeType", inferCertificateMimeType(file));
      form.append("sizeBytes", String(file.size));
      form.append("file", file);

      const res = await fetch(`/api/admin/submissions/${submissionId}/certificate`, {
        method: "POST",
        body: form,
      });
      const json = (await res.json().catch(() => null)) as CertificateUploadResponse | null;
      if (!res.ok || json?.error) {
        throw new Error(json?.error || "업로드에 실패했습니다.");
      }
      if (json?.certificate) {
        setCurrentFile({
          objectKey: json.certificate.objectKey,
          name: normalizeDisplayFilename(json.certificate.originalName),
          uploadedAt: json.certificate.uploadedAt,
        });
      }
      const successMessage = "필증 업로드가 완료되었습니다.";
      setNotice(successMessage);
      setSavePopup({ id: Date.now(), message: successMessage });
      setFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      router.refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "업로드에 실패했습니다.");
    } finally {
      setIsUploading(false);
    }
  };

  const handlePickFile = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files?.[0] ?? null;
    setFile(selected);
    setNotice(null);
  };

  return (
    <div className="space-y-3">
      {savePopup ? (
        <AdminSaveToast key={savePopup.id} message={savePopup.message} />
      ) : null}
      <div className="text-xs text-muted-foreground">
        현재 파일: {currentFile.name ?? "없음"}
        {currentFile.uploadedAt
          ? ` · 업로드: ${new Date(currentFile.uploadedAt).toLocaleString()}`
          : ""}
      </div>
      {currentFile.objectKey ? (
        <a
          className="inline-flex rounded-full border border-border/70 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-foreground transition hover:border-foreground"
          href={`/api/b2/download?filePath=${encodeURIComponent(currentFile.objectKey)}`}
          target="_blank"
          rel="noreferrer"
        >
          현재 필증 다운로드
        </a>
      ) : null}
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf,image/png,image/jpeg,.pdf,.png,.jpg,.jpeg"
          onChange={handleFileChange}
          className="hidden"
        />
        <button
          type="button"
          onClick={handlePickFile}
          disabled={isUploading}
          className="rounded-full border border-border/70 bg-background px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-foreground transition hover:border-foreground hover:bg-foreground/5 disabled:cursor-not-allowed disabled:opacity-60"
        >
          파일 선택
        </button>
        <span className="max-w-full truncate text-xs text-muted-foreground sm:max-w-[320px]">
          {file ? file.name : "선택된 파일 없음"}
        </span>
        <button
          type="button"
          onClick={handleUpload}
          disabled={isUploading || !file}
          className="rounded-full border border-border/70 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-foreground transition hover:border-foreground hover:bg-foreground/5 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isUploading ? "업로드 중..." : "필증 업로드"}
        </button>
      </div>
      {notice ? <p className="text-xs text-muted-foreground">{notice}</p> : null}
    </div>
  );
}
