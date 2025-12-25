"use client";

import * as React from "react";

import { APP_CONFIG } from "@/lib/config";
import { createClient } from "@/lib/supabase/client";

import { createKaraokeRequestAction, type KaraokeActionState } from "./actions";

type UploadState = {
  name: string;
  progress: number;
  status: "idle" | "uploading" | "done" | "error";
  path?: string;
};

const uploadMaxBytes = APP_CONFIG.uploadMaxMb * 1024 * 1024;

export function KaraokeForm({ userId }: { userId: string }) {
  const supabase = React.useMemo(() => createClient(), []);
  const [title, setTitle] = React.useState("");
  const [artist, setArtist] = React.useState("");
  const [contact, setContact] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [file, setFile] = React.useState<File | null>(null);
  const [upload, setUpload] = React.useState<UploadState>({
    name: "",
    progress: 0,
    status: "idle",
  });
  const [notice, setNotice] = React.useState<KaraokeActionState>({});
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  const onFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files?.[0] ?? null;
    if (!selected) {
      setFile(null);
      setUpload({ name: "", progress: 0, status: "idle" });
      return;
    }
    if (selected.size > uploadMaxBytes) {
      setNotice({
        error: `파일 용량은 ${APP_CONFIG.uploadMaxMb}MB 이하만 가능합니다.`,
      });
      return;
    }
    setNotice({});
    setFile(selected);
    setUpload({ name: selected.name, progress: 0, status: "idle" });
  };

  const uploadWithProgress = async (signedUrl: string, selected: File) => {
    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.upload.onprogress = (event) => {
        if (!event.lengthComputable) return;
        const percent = Math.round((event.loaded / event.total) * 100);
        setUpload((prev) => ({ ...prev, progress: percent }));
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

  const handleSubmit = async () => {
    if (!title || !contact) {
      setNotice({ error: "곡명과 연락처를 입력해주세요." });
      return;
    }

    setIsSubmitting(true);
    setNotice({});
    try {
      let filePath: string | undefined;
      if (file) {
        const fileName = `${Date.now()}-${file.name.replace(/\s+/g, "_")}`;
        const path = `${userId}/karaoke/${fileName}`;
        setUpload((prev) => ({ ...prev, status: "uploading" }));

        const { data, error } = await supabase.storage
          .from("submissions")
          .createSignedUploadUrl(path, { upsert: true });

        if (error || !data) {
          setUpload((prev) => ({ ...prev, status: "error" }));
          setNotice({ error: "파일 업로드 URL 생성 실패" });
          return;
        }

        await uploadWithProgress(data.signedUrl, file);
        setUpload((prev) => ({ ...prev, status: "done", progress: 100 }));
        filePath = data.path;
      }

      const result = await createKaraokeRequestAction({
        title,
        artist: artist || undefined,
        contact,
        notes: notes || undefined,
        filePath,
      });

      if (result.error) {
        setNotice({ error: result.error });
        return;
      }

      setNotice({ message: result.message });
      setTitle("");
      setArtist("");
      setContact("");
      setNotes("");
      setFile(null);
      setUpload({ name: "", progress: 0, status: "idle" });
    } catch {
      setNotice({ error: "요청 처리 중 오류가 발생했습니다." });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            곡명
          </label>
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className="w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-foreground"
          />
        </div>
        <div className="space-y-2">
          <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            아티스트
          </label>
          <input
            value={artist}
            onChange={(event) => setArtist(event.target.value)}
            className="w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-foreground"
          />
        </div>
        <div className="space-y-2 md:col-span-2">
          <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            연락처
          </label>
          <input
            value={contact}
            onChange={(event) => setContact(event.target.value)}
            className="w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-foreground"
          />
        </div>
        <div className="space-y-2 md:col-span-2">
          <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            요청 사항
          </label>
          <textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            className="h-24 w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-foreground"
          />
        </div>
      </div>

      <div className="rounded-[28px] border border-border/60 bg-card/80 p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
          파일/링크
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          음원 또는 참고 자료를 업로드하세요. (선택)
        </p>
        <input
          type="file"
          onChange={onFileChange}
          className="mt-4 w-full rounded-2xl border border-dashed border-border/70 bg-background/60 px-4 py-6 text-sm text-muted-foreground"
        />
        {upload.name && (
          <div className="mt-4 rounded-2xl border border-border/60 bg-background/70 px-4 py-3 text-xs">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-foreground">{upload.name}</span>
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
        )}
      </div>

      {notice.error && (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs text-red-600">
          {notice.error}
        </div>
      )}
      {notice.message && (
        <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-xs text-emerald-600">
          {notice.message}
        </div>
      )}

      <button
        type="button"
        onClick={handleSubmit}
        disabled={isSubmitting}
        className="rounded-full bg-foreground px-6 py-3 text-xs font-semibold uppercase tracking-[0.2em] text-background transition hover:-translate-y-0.5 hover:bg-foreground/90 disabled:cursor-not-allowed disabled:bg-muted"
      >
        등록 요청하기
      </button>
    </div>
  );
}
