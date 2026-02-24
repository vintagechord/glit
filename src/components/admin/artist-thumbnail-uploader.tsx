"use client";

import Image from "next/image";
import * as React from "react";

type Props = {
  initialUrl?: string | null;
};

type UploadResponse = {
  ok?: boolean;
  objectKey?: string;
  previewUrl?: string;
  error?: string;
};

const buildPreviewUrl = (objectKey: string) =>
  `/api/admin/uploads/free?objectKey=${encodeURIComponent(objectKey)}`;

const parseObjectKeyFromUrl = (value?: string | null) => {
  const url = value?.trim();
  if (!url) return null;
  try {
    const parsed = new URL(url, "http://localhost");
    if (parsed.pathname !== "/api/admin/uploads/free") return null;
    const objectKey = parsed.searchParams.get("objectKey");
    return objectKey ? decodeURIComponent(objectKey) : null;
  } catch {
    return null;
  }
};

export function ArtistThumbnailUploader({ initialUrl }: Props) {
  const initialObjectKey = React.useMemo(
    () => parseObjectKeyFromUrl(initialUrl),
    [initialUrl],
  );

  const [thumbnailUrl, setThumbnailUrl] = React.useState(
    initialUrl?.trim() ?? "",
  );
  const [objectKey, setObjectKey] = React.useState<string | null>(
    initialObjectKey,
  );
  const [isUploading, setIsUploading] = React.useState(false);
  const [isDeleting, setIsDeleting] = React.useState(false);
  const [notice, setNotice] = React.useState<string | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);

  const deleteObjectByKey = React.useCallback(async (key: string) => {
    const res = await fetch("/api/admin/uploads/free", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ objectKey: key }),
    });
    const payload = (await res.json().catch(() => null)) as
      | { error?: string }
      | null;
    if (!res.ok) {
      throw new Error(payload?.error || "기존 썸네일 삭제에 실패했습니다.");
    }
  }, []);

  const handlePickImage = () => {
    fileInputRef.current?.click();
  };

  const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setNotice("이미지 파일만 업로드할 수 있습니다.");
      return;
    }

    const maxBytes = 20 * 1024 * 1024;
    if (file.size > maxBytes) {
      setNotice("이미지 크기는 20MB 이하만 허용됩니다.");
      return;
    }

    setIsUploading(true);
    setNotice(null);
    try {
      const form = new FormData();
      form.append("filename", file.name);
      form.append("mimeType", file.type || "application/octet-stream");
      form.append("sizeBytes", String(file.size));
      form.append("label", "artist-thumbnail");
      form.append("file", file);

      const res = await fetch("/api/admin/uploads/free", {
        method: "POST",
        body: form,
      });
      const payload = (await res.json().catch(() => null)) as
        | UploadResponse
        | null;
      const nextKey = payload?.objectKey?.trim() ?? "";
      if (!res.ok || !nextKey) {
        throw new Error(payload?.error || "썸네일 업로드에 실패했습니다.");
      }

      const nextPreviewUrl = payload?.previewUrl?.trim() || buildPreviewUrl(nextKey);
      setObjectKey(nextKey);
      setThumbnailUrl(nextPreviewUrl);
      setNotice("썸네일이 업로드되었습니다. 저장 버튼을 눌러 반영하세요.");
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "썸네일 업로드에 실패했습니다.",
      );
    } finally {
      setIsUploading(false);
    }
  };

  const handleDelete = async () => {
    setIsDeleting(true);
    setNotice(null);
    try {
      if (objectKey) {
        await deleteObjectByKey(objectKey);
      }
      setObjectKey(null);
      setThumbnailUrl("");
      setNotice("썸네일을 삭제했습니다. 저장 버튼을 눌러 반영하세요.");
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "썸네일 삭제에 실패했습니다.",
      );
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="space-y-3">
      <input type="hidden" name="thumbnailUrl" value={thumbnailUrl} />
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleUpload}
        className="hidden"
      />

      <div className="flex items-start gap-3">
        <div className="relative h-16 w-16 overflow-hidden rounded-2xl border border-border/60 bg-background">
          {thumbnailUrl ? (
            <Image
              src={thumbnailUrl}
              alt="썸네일 미리보기"
              fill
              sizes="64px"
              className="object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-[10px] font-semibold text-muted-foreground">
              NO IMG
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handlePickImage}
              disabled={isUploading || isDeleting}
              className="rounded-full border border-border/70 bg-background px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.2em] text-foreground transition hover:border-foreground"
            >
              {isUploading ? "업로드 중..." : "이미지 선택"}
            </button>
            <button
              type="button"
              onClick={handleDelete}
              disabled={!thumbnailUrl || isUploading || isDeleting}
              className="rounded-full border border-border/70 bg-background px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.2em] text-foreground transition hover:border-foreground disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isDeleting ? "삭제 중..." : "삭제"}
            </button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            이미지를 선택하면 스토리지에 자동 업로드됩니다.
          </p>
          {notice ? <p className="text-[11px] text-muted-foreground">{notice}</p> : null}
        </div>
      </div>
    </div>
  );
}
