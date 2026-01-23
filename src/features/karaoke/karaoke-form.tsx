"use client";

import * as React from "react";

import { APP_CONFIG } from "@/lib/config";
import { formatCurrency } from "@/lib/format";
import { safeRandomUUID } from "@/lib/uuid";

import {
  createKaraokeRequestAction,
  type KaraokeActionState,
} from "./actions";

type UploadState = {
  name: string;
  progress: number;
  status: "idle" | "uploading" | "done" | "error";
  path?: string;
};

const uploadMaxBytes = APP_CONFIG.uploadMaxMb * 1024 * 1024;

const mapFileKind = (file: File): "AUDIO" | "VIDEO" | "LYRICS" | "ETC" => {
  const mime = (file.type || "").toLowerCase();
  const name = file.name.toLowerCase();
  if (mime.startsWith("audio/")) return "AUDIO";
  if (mime.startsWith("video/")) return "VIDEO";
  if (name.endsWith(".lrc") || name.endsWith(".txt")) return "LYRICS";
  return "ETC";
};

export function KaraokeForm({ userId }: { userId?: string | null }) {
  const isGuest = !userId;
  const [title, setTitle] = React.useState("");
  const [artist, setArtist] = React.useState("");
  const [contact, setContact] = React.useState("");
  const [guestName, setGuestName] = React.useState("");
  const [guestEmail, setGuestEmail] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [paymentMethod, setPaymentMethod] = React.useState<"CARD" | "BANK">(
    "BANK",
  );
  const [bankDepositorName, setBankDepositorName] = React.useState("");
  const [tjRequested, setTjRequested] = React.useState(true);
  const [kyRequested, setKyRequested] = React.useState(true);
  const [file, setFile] = React.useState<File | null>(null);
  const [upload, setUpload] = React.useState<UploadState>({
    name: "",
    progress: 0,
    status: "idle",
  });
  const [notice, setNotice] = React.useState<KaraokeActionState>({});
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const guestTokenRef = React.useRef<string | null>(null);
  const uploadIdRef = React.useRef<string | null>(null);
  const [isDraggingOver, setIsDraggingOver] = React.useState(false);

  if (!guestTokenRef.current) {
    guestTokenRef.current = safeRandomUUID();
  }

  if (!uploadIdRef.current) {
    uploadIdRef.current = safeRandomUUID();
  }

  const handleSelectedFile = (selected: File | null) => {
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

  const onFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files?.[0] ?? null;
    handleSelectedFile(selected);
  };

  const onDropFiles = (event: React.DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    const selected = event.dataTransfer.files?.[0] ?? null;
    setIsDraggingOver(false);
    handleSelectedFile(selected);
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

  const createSignedUpload = async (selected: File) => {
    const response = await fetch("/api/uploads/presign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        submissionId: uploadIdRef.current,
        filename: selected.name,
        mimeType: selected.type,
        sizeBytes: selected.size,
        guestToken: isGuest ? guestTokenRef.current ?? undefined : undefined,
        title,
      }),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(
        typeof payload?.error === "string"
          ? payload.error
          : "업로드 URL을 생성할 수 없습니다.",
      );
    }

    return payload as { uploadUrl: string; objectKey: string };
  };

  const handleSubmit = async () => {
    if (!title || !contact) {
      setNotice({ error: "곡명과 연락처를 입력해주세요." });
      return;
    }
    if (isGuest && (!guestName || !guestEmail)) {
      setNotice({ error: "담당자명과 이메일을 입력해주세요." });
      return;
    }
    if (!tjRequested && !kyRequested) {
      setNotice({ error: "등록 요청 방송사를 선택해주세요." });
      return;
    }
    if (paymentMethod === "BANK" && !bankDepositorName.trim()) {
      setNotice({ error: "입금자명을 입력해주세요." });
      return;
    }

    setIsSubmitting(true);
    setNotice({});
    try {
      let filePath: string | undefined;
      if (file) {
        setUpload((prev) => ({ ...prev, status: "uploading" }));

        let signedUrl: string;
        let path: string;
        try {
          const uploadData = await createSignedUpload(file);
          signedUrl = uploadData.uploadUrl;
          path = uploadData.objectKey;
        } catch (error) {
          setUpload((prev) => ({ ...prev, status: "error" }));
          const message =
            error instanceof Error && error.message
              ? error.message
              : "파일 업로드 URL 생성 실패";
          setNotice({ error: message });
          return;
        }

        await uploadWithProgress(signedUrl, file);
        setUpload((prev) => ({ ...prev, status: "done", progress: 100 }));
        await fetch("/api/uploads/complete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            key: path,
            submissionId: uploadIdRef.current,
            sizeBytes: file.size,
            filename: file.name,
            kind: mapFileKind(file),
            mimeType: file.type || "application/octet-stream",
            guestToken: isGuest ? guestTokenRef.current ?? undefined : undefined,
          }),
        }).catch(() => null);
        filePath = path;
      }

      const result = await createKaraokeRequestAction({
        title,
        artist: artist || undefined,
        contact,
        notes: notes || undefined,
        filePath,
        paymentMethod,
        bankDepositorName:
          paymentMethod === "BANK" ? bankDepositorName.trim() : undefined,
        tjRequested,
        kyRequested,
        guestName: isGuest ? guestName : undefined,
        guestEmail: isGuest ? guestEmail : undefined,
        guestPhone: isGuest ? contact : undefined,
      });

      if (result.error) {
        setNotice({ error: result.error });
        return;
      }

      setNotice({ message: result.message });
      setTitle("");
      setArtist("");
      setContact("");
      setGuestName("");
      setGuestEmail("");
      setNotes("");
      setPaymentMethod("BANK");
      setBankDepositorName("");
      setTjRequested(true);
      setKyRequested(true);
      setFile(null);
      setUpload({ name: "", progress: 0, status: "idle" });
    } catch {
      setNotice({ error: "요청 처리 중 오류가 발생했습니다." });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-8">
      {isDraggingOver && (
        <div className="pointer-events-none fixed inset-0 z-40 bg-black/10 backdrop-blur-[1px]" />
      )}
      <div className="rounded-[28px] border border-border/60 bg-card/80 p-6 text-sm text-muted-foreground">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
          노래방 등록 신청하기
        </p>
        <p className="mt-3 text-sm">
          태진/금영 등록을 <strong>글릿</strong>이 대행합니다. 신청 후 진행상황 탭에서
            단계별 진행을 확인할 수 있습니다.
        </p>
        <p className="mt-3 text-xs text-muted-foreground">
          기본 신청 비용 {formatCurrency(APP_CONFIG.karaokeFeeKrw)}원
        </p>
      </div>

      <div className="grid gap-6">
        <div className="grid gap-4 md:grid-cols-2">
          {isGuest && (
            <>
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                  담당자명
                </label>
                <input
                  value={guestName}
                  onChange={(event) => setGuestName(event.target.value)}
                  className="w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-foreground"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                  이메일
                </label>
                <input
                  type="email"
                  value={guestEmail}
                  onChange={(event) => setGuestEmail(event.target.value)}
                  className="w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-foreground"
                />
              </div>
            </>
          )}
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
            등록 요청 방송사
          </p>
          <div className="mt-4 flex flex-wrap gap-3 text-xs text-muted-foreground">
            <label className="flex items-center gap-2 rounded-full border border-border/70 px-4 py-2">
              <input
                type="checkbox"
                checked={tjRequested}
                onChange={() => setTjRequested((prev) => !prev)}
                className="h-4 w-4 rounded border-border"
              />
              태진
            </label>
            <label className="flex items-center gap-2 rounded-full border border-border/70 px-4 py-2">
              <input
                type="checkbox"
                checked={kyRequested}
                onChange={() => setKyRequested((prev) => !prev)}
                className="h-4 w-4 rounded border-border"
              />
              금영
            </label>
          </div>
        </div>

        <div className="rounded-[28px] border border-border/60 bg-card/80 p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
            파일/링크
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            음원 또는 참고 자료를 업로드하세요. (선택)
          </p>
          <div className="mt-4">
            <label
              className="relative block"
              onDragOver={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setIsDraggingOver(true);
              }}
              onDragEnter={() => setIsDraggingOver(true)}
              onDragLeave={(event) => {
                event.preventDefault();
                setIsDraggingOver(false);
              }}
              onDrop={onDropFiles}
            >
              <span className="sr-only">파일 첨부</span>
              <input
                type="file"
                onChange={onFileChange}
                className="hidden"
              />
              <span className="flex w-full items-center justify-center rounded-2xl border border-dashed border-border/70 bg-background/60 px-4 py-6 text-sm font-semibold text-foreground transition hover:border-foreground">
                파일 첨부 (드래그 앤 드롭 가능)
              </span>
              {isDraggingOver && (
                <div className="pointer-events-none absolute inset-0 rounded-2xl border-2 border-amber-300 bg-black/10 backdrop-blur-[1px]" />
              )}
            </label>
          </div>
          {upload.name && (
            <div className="mt-4 space-y-3">
              <div className="rounded-2xl border border-border/60 bg-background/70 px-4 py-3 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="font-semibold text-foreground">
                    {upload.name}
                  </span>
                  <div className="flex items-center gap-3">
                    <span className="text-muted-foreground">
                      {upload.status === "done"
                        ? "첨부 완료"
                        : upload.status === "uploading"
                          ? `업로드 중 · ${upload.progress}%`
                          : upload.status === "error"
                            ? "실패"
                            : "대기"}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setFile(null);
                        setUpload({ name: "", progress: 0, status: "idle" });
                        setIsDraggingOver(false);
                      }}
                      className="rounded-full border border-border/60 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground transition hover:border-rose-400 hover:text-rose-500"
                    >
                      삭제
                    </button>
                  </div>
                </div>
                <div className="mt-2 h-1.5 w-full rounded-full bg-muted">
                  <div
                    className="h-1.5 rounded-full bg-foreground transition-all"
                    style={{ width: `${upload.progress}%` }}
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="rounded-[28px] border border-border/60 bg-card/80 p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
            결제 방식 선택
          </p>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <button
              type="button"
              onClick={() => setPaymentMethod("CARD")}
              className={`rounded-2xl border p-4 text-left transition ${
                paymentMethod === "CARD"
                  ? "border-foreground bg-foreground text-background"
                  : "border-border/60 bg-background text-foreground hover:border-foreground"
              }`}
            >
              <p className="text-xs font-semibold uppercase tracking-[0.2em] opacity-70">
                Card
              </p>
              <p className="mt-2 text-sm font-semibold">카드 결제</p>
              <p className="mt-2 text-xs opacity-80">
                결제 모듈 연동 후 자동화 예정입니다.
              </p>
            </button>
            <button
              type="button"
              onClick={() => setPaymentMethod("BANK")}
              className={`rounded-2xl border p-4 text-left transition ${
                paymentMethod === "BANK"
                  ? "border-foreground bg-foreground text-background"
                  : "border-border/60 bg-background text-foreground hover:border-foreground"
              }`}
            >
              <p className="text-xs font-semibold uppercase tracking-[0.2em] opacity-70">
                Bank
              </p>
              <p className="mt-2 text-sm font-semibold">무통장 입금</p>
              <p className="mt-2 text-xs opacity-80">
                입금 확인 후 요청이 진행됩니다.
              </p>
            </button>
          </div>

          {paymentMethod === "BANK" && (
            <div className="mt-4 rounded-2xl border border-border/60 bg-background/70 p-4 text-xs text-muted-foreground">
              <div className="grid gap-3 md:grid-cols-3">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.2em]">
                    은행
                  </p>
                  <p className="mt-1 font-semibold text-foreground">
                    {APP_CONFIG.bankName}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-[0.2em]">
                    계좌번호
                  </p>
                  <p className="mt-1 font-semibold text-foreground">
                    {APP_CONFIG.bankAccount}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-[0.2em]">
                    예금주
                  </p>
                  <p className="mt-1 font-semibold text-foreground">
                    {APP_CONFIG.bankHolder}
                  </p>
                </div>
              </div>
              <div className="mt-4 space-y-2">
                <label className="text-[11px] font-semibold uppercase tracking-[0.2em]">
                  입금자명
                </label>
                <input
                  value={bankDepositorName}
                  onChange={(event) =>
                    setBankDepositorName(event.target.value)
                  }
                  className="w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-foreground"
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
    </div>
  );
}
