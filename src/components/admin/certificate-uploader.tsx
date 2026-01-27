"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

type Props = {
  submissionId: string;
  currentName?: string | null;
  currentUploadedAt?: string | null;
};

export function CertificateUploader({ submissionId, currentName, currentUploadedAt }: Props) {
  const [file, setFile] = React.useState<File | null>(null);
  const [isUploading, setIsUploading] = React.useState(false);
  const router = useRouter();

  const handleUpload = async () => {
    if (!file) {
      alert("업로드할 파일을 선택하세요.");
      return;
    }
    const allowedTypes = ["application/pdf", "image/png", "image/jpeg"];
    if (!allowedTypes.includes(file.type)) {
      alert("PDF, PNG, JPG만 업로드할 수 있습니다.");
      return;
    }
    const maxSize = 20 * 1024 * 1024;
    if (file.size > maxSize) {
      alert("파일 크기는 20MB 이하만 허용됩니다.");
      return;
    }
    setIsUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("filename", file.name);
      form.append("mimeType", file.type || "application/octet-stream");
      form.append("sizeBytes", String(file.size));

      const res = await fetch(`/api/admin/submissions/${submissionId}/certificate`, {
        method: "POST",
        body: form,
      });
      const json = (await res.json().catch(() => null)) as { error?: string };
      if (!res.ok || json?.error) {
        throw new Error(json?.error || "업로드에 실패했습니다.");
      }
      alert("필증 업로드가 완료되었습니다.");
      setFile(null);
      router.refresh();
    } catch (error) {
      alert(error instanceof Error ? error.message : "업로드에 실패했습니다.");
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="text-xs text-muted-foreground">
        현재 파일: {currentName ?? "없음"}
        {currentUploadedAt ? ` · 업로드: ${new Date(currentUploadedAt).toLocaleString()}` : ""}
      </div>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <input
          type="file"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="w-64 rounded-xl border border-border/70 bg-background px-3 py-2 text-sm text-foreground"
        />
        <button
          type="button"
          onClick={handleUpload}
          disabled={isUploading}
          className="rounded-full border border-border/70 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-foreground transition hover:border-foreground hover:bg-foreground/5 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isUploading ? "업로드 중..." : "필증 업로드"}
        </button>
      </div>
    </div>
  );
}
