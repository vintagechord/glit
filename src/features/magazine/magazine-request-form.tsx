"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CheckCircle2, ImageUp, Info, SendHorizontal } from "lucide-react";

import { createMagazineRequestAction } from "./actions";

export type MagazineExistingRequest = {
  id: string;
  status: string | null;
  targetChannel: string | null;
  albumTitle: string | null;
  artistName: string | null;
  createdAt: string | null;
  publishedUrl: string | null;
};

const channelOptions = [
  {
    value: "DOMESTIC_NEWS",
    label: "국내뉴스",
    description: "발매 소식과 앨범 소개 중심",
  },
  {
    value: "MEDIA",
    label: "미디어",
    description: "영상·콘텐츠 링크를 함께 강조",
  },
] as const;

const statusLabels: Record<string, string> = {
  REQUESTED: "요청 접수",
  WRITING: "작성 중",
  PUBLISHED: "발행 완료",
  CANCELED: "취소",
};

const channelLabels: Record<string, string> = {
  DOMESTIC_NEWS: "국내뉴스",
  MEDIA: "미디어",
};

const formatDate = (value?: string | null) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeZone: "Asia/Seoul",
  }).format(date);
};

const fieldClass =
  "w-full rounded-[8px] border-2 border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-[#1556a4]";

const labelClass =
  "text-[11px] font-black uppercase tracking-normal text-muted-foreground";

export function MagazineRequestForm({
  isAuthenticated,
  userEmail,
  requesterName,
  requesterPhone,
  existingRequests,
  availableCredits,
}: {
  isAuthenticated: boolean;
  userEmail?: string | null;
  requesterName?: string | null;
  requesterPhone?: string | null;
  existingRequests: MagazineExistingRequest[];
  availableCredits: number;
}) {
  const router = useRouter();
  const [isPending, startTransition] = React.useTransition();
  const [notice, setNotice] = React.useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [targetChannel, setTargetChannel] =
    React.useState<(typeof channelOptions)[number]["value"]>("DOMESTIC_NEWS");
  const [artworkFileName, setArtworkFileName] = React.useState("");

  const hasAvailableCredits = availableCredits > 0;
  const canSubmit = isAuthenticated && hasAvailableCredits;

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    formData.set("targetChannel", targetChannel);

    setNotice(null);
    startTransition(async () => {
      const result = await createMagazineRequestAction(formData);

      if (result.error) {
        setNotice({ type: "error", text: result.error });
        return;
      }

      form.reset();
      setArtworkFileName("");
      setNotice({
        type: "success",
        text:
          result.message ??
          "매거진 발행 요청이 접수되었습니다. 관리자가 내용을 확인합니다.",
      });
      router.refresh();
    });
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_0.88fr]">
      <section className="rounded-[10px] border-2 border-[#111111] bg-card p-5 shadow-[5px_5px_0_#111111] dark:border-white/70 dark:shadow-[5px_5px_0_#1556a4] sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="bauhaus-kicker">Request</p>
            <h2 className="mt-3 text-2xl font-black text-foreground">
              워터멜론 매거진 발행 요청
            </h2>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-[8px] border-2 border-[#1556a4] bg-[#eaf2fb] px-3 py-1 text-[11px] font-black text-[#1556a4] dark:border-[#8bc3ff] dark:bg-[#102033] dark:text-[#8bc3ff]">
            <Info className="h-3.5 w-3.5" aria-hidden="true" />
            1크레딧 사용
          </span>
        </div>

        {notice ? (
          <div
            className={`mt-5 rounded-[8px] border-2 px-4 py-3 text-sm font-semibold ${
              notice.type === "success"
                ? "border-[#1f7a5a] bg-emerald-500/10 text-[#1f7a5a]"
                : "border-[#d9362c] bg-[#d9362c]/10 text-[#d9362c]"
            }`}
          >
            {notice.text}
          </div>
        ) : null}

        {!isAuthenticated ? (
          <div className="mt-5 rounded-[8px] border-2 border-[#111111] bg-background p-5">
            <p className="text-sm font-black text-foreground">
              크레딧 사용은 회원만 가능합니다.
            </p>
            <p className="mt-2 text-xs font-semibold leading-5 text-muted-foreground">
              로그인 후 보유 크레딧으로 매거진 등록을 신청할 수 있습니다.
            </p>
            <Link
              href={`/login?next=${encodeURIComponent("/magazine#credit-use")}`}
              className="mt-4 inline-flex min-h-10 items-center justify-center rounded-[8px] border-2 border-[#111111] bg-[#111111] px-4 py-2 text-xs font-black text-white transition hover:-translate-y-0.5"
            >
              로그인 후 크레딧 사용
            </Link>
          </div>
        ) : null}

        <form
          onSubmit={handleSubmit}
          encType="multipart/form-data"
          className="mt-6 space-y-6"
        >
          <div className="space-y-3">
            <p className={labelClass}>발행 위치 선택</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {channelOptions.map((option) => {
                const selected = targetChannel === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setTargetChannel(option.value)}
                    className={`min-h-[94px] rounded-[8px] border-2 p-4 text-left transition ${
                      selected
                        ? "border-[#111111] bg-[#d9362c] text-white shadow-[4px_4px_0_#111111] dark:border-[#f2cf27] dark:bg-[#ff6258] dark:text-[#111111] dark:shadow-[4px_4px_0_#f2cf27]"
                        : "border-border bg-background text-foreground hover:border-[#1556a4]"
                    }`}
                  >
                    <span className="flex items-center justify-between gap-3">
                      <span className="font-black">{option.label}</span>
                      {selected ? (
                        <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
                      ) : null}
                    </span>
                    <span className="mt-2 block text-xs font-semibold opacity-75">
                      {option.description}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="rounded-[8px] border-2 border-[#1556a4]/35 bg-[#eaf2fb] p-4 text-[#1556a4] dark:border-[#8bc3ff]/60 dark:bg-[#102033] dark:text-[#8bc3ff]">
            <p className={labelClass}>신청 방식</p>
            <p className="mt-2 text-sm font-black leading-6">
              음반심의 접수건 연결 없이 보유 크레딧 1개로 매거진 등록을 신청할 수
              있습니다.
            </p>
            <p className="mt-1 text-xs font-semibold leading-5 opacity-80">
              현재 사용 가능 크레딧은{" "}
              {isAuthenticated ? availableCredits.toLocaleString() : "-"}개입니다.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="grid gap-2">
              <span className={labelClass}>담당자명</span>
              <input
                name="requesterName"
                required
                disabled={!isAuthenticated}
                defaultValue={requesterName ?? ""}
                className={fieldClass}
              />
            </label>
            <label className="grid gap-2">
              <span className={labelClass}>이메일</span>
              <input
                name="requesterEmail"
                type="email"
                required
                disabled={!isAuthenticated}
                defaultValue={userEmail ?? ""}
                className={fieldClass}
              />
            </label>
            <label className="grid gap-2">
              <span className={labelClass}>연락처</span>
              <input
                name="requesterPhone"
                disabled={!isAuthenticated}
                defaultValue={requesterPhone ?? ""}
                className={fieldClass}
              />
            </label>
            <label className="grid gap-2">
              <span className={labelClass}>발매일</span>
              <input
                name="releaseDate"
                type="date"
                disabled={!isAuthenticated}
                className={fieldClass}
              />
            </label>
            <label className="grid gap-2">
              <span className={labelClass}>앨범명 / 콘텐츠명</span>
              <input
                name="albumTitle"
                disabled={!isAuthenticated}
                placeholder="매거진에 표시할 제목"
                className={fieldClass}
              />
            </label>
            <label className="grid gap-2">
              <span className={labelClass}>아티스트명 / 표시명</span>
              <input
                name="artistName"
                disabled={!isAuthenticated}
                className={fieldClass}
              />
            </label>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <label className="grid gap-2 lg:col-span-2">
              <span className={labelClass}>아트워크 파일</span>
              <input
                id="magazine-artwork-file"
                name="artworkFile"
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                disabled={!isAuthenticated}
                onChange={(event) =>
                  setArtworkFileName(event.target.files?.[0]?.name ?? "")
                }
                className="sr-only"
              />
              <span
                className={`flex min-h-[62px] items-center gap-3 rounded-[8px] border-2 border-border bg-background px-4 py-3 text-sm text-foreground transition ${
                  isAuthenticated
                    ? "cursor-pointer hover:border-[#1556a4]"
                    : "cursor-not-allowed opacity-60"
                }`}
              >
                <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[6px] bg-[#111111] text-white">
                  <ImageUp className="h-5 w-5" aria-hidden="true" />
                </span>
                <span className="grid min-w-0 gap-1">
                  <span className="truncate font-black text-foreground">
                    {artworkFileName || "선택된 파일 없음"}
                  </span>
                  <span className="text-[11px] font-semibold text-muted-foreground">
                    JPG, PNG, WEBP, GIF · 20MB 이하
                  </span>
                </span>
              </span>
            </label>
            <label className="grid gap-2">
              <span className={labelClass}>멜론 또는 지니 링크</span>
              <input
                name="albumUrl"
                disabled={!isAuthenticated}
                placeholder="멜론 또는 지니 링크"
                className={fieldClass}
              />
            </label>
            <label className="grid gap-2">
              <span className={labelClass}>유튜브 영상 주소</span>
              <input
                name="videoUrl"
                disabled={!isAuthenticated}
                placeholder="유튜브 영상 주소"
                className={fieldClass}
              />
            </label>
          </div>

          <label className="grid gap-2">
            <span className={labelClass}>직접 작성한 매거진 기사 내용</span>
            <textarea
              name="articleBody"
              rows={6}
              disabled={!isAuthenticated}
              placeholder="원하는 기사 톤, 소개 문장, 강조하고 싶은 포인트를 자유롭게 적어주세요."
              className={fieldClass}
            />
          </label>

          <label className="grid gap-2">
            <span className={labelClass}>크레딧 / 참여진</span>
            <textarea
              name="creditsText"
              rows={4}
              disabled={!isAuthenticated}
              placeholder="작사, 작곡, 편곡, 프로듀서, 연주자, 출연진 등"
              className={fieldClass}
            />
          </label>

          <label className="grid gap-2">
            <span className={labelClass}>기타 요청사항</span>
            <textarea
              name="notes"
              rows={4}
              disabled={!isAuthenticated}
              placeholder="발행 희망일, 참고 링크, 언론자료 메모 등"
              className={fieldClass}
            />
          </label>

          <button
            type="submit"
            disabled={isPending || !canSubmit}
            className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-[8px] border-2 border-[#111111] bg-[#111111] px-5 py-3 text-sm font-black text-white shadow-[4px_4px_0_#1556a4] transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:border-border disabled:bg-muted disabled:text-muted-foreground disabled:shadow-none"
          >
            <SendHorizontal className="h-4 w-4" aria-hidden="true" />
            {!isAuthenticated
              ? "로그인 후 이용"
              : !hasAvailableCredits
                ? "사용 가능한 크레딧 없음"
              : isPending
                ? "요청 접수 중..."
                : "크레딧 사용해서 발행 요청"}
          </button>
        </form>
      </section>

      <aside className="space-y-5">
        <section className="rounded-[10px] border-2 border-[#111111] bg-background p-5 dark:border-white/70">
          <p className="bauhaus-kicker">Credits</p>
          <h2 className="mt-3 text-xl font-black text-foreground">
            보유 크레딧
          </h2>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="rounded-[8px] border-2 border-border bg-card p-4">
              <p className={labelClass}>사용 가능</p>
              <p className="mt-2 text-3xl font-black text-foreground">
                {isAuthenticated ? availableCredits : "-"}
              </p>
            </div>
            <div className="rounded-[8px] border-2 border-border bg-card p-4">
              <p className={labelClass}>요청 완료</p>
              <p className="mt-2 text-3xl font-black text-foreground">
                {isAuthenticated ? existingRequests.length : "-"}
              </p>
            </div>
          </div>
          <p className="mt-4 text-xs leading-5 text-muted-foreground">
            매거진 등록 신청 1회 또는 서비스 이용권 교환 시 잔여 크레딧에서
            차감됩니다.
          </p>
        </section>

        <section className="rounded-[10px] border-2 border-border bg-card p-5">
          <p className="bauhaus-kicker">Submitted</p>
          <h2 className="mt-3 text-xl font-black text-foreground">
            요청 내역
          </h2>
          {isAuthenticated && existingRequests.length > 0 ? (
            <div className="mt-4 space-y-3">
              {existingRequests.map((request) => (
                <div
                  key={request.id}
                  className="rounded-[8px] border-2 border-border bg-background p-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-black text-foreground">
                      {request.albumTitle ?? "제목 미입력"}
                    </p>
                    <span className="rounded-[6px] bg-[#eaf2fb] px-2 py-1 text-[10px] font-black text-[#1556a4] dark:bg-[#102033] dark:text-[#8bc3ff]">
                      {statusLabels[request.status ?? ""] ?? request.status}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {request.artistName ?? "-"} ·{" "}
                    {channelLabels[request.targetChannel ?? ""] ??
                      request.targetChannel ??
                      "-"}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    요청일 {formatDate(request.createdAt)}
                  </p>
                  {request.publishedUrl ? (
                    <a
                      href={request.publishedUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-3 inline-flex rounded-[8px] border-2 border-[#111111] px-3 py-2 text-xs font-black text-foreground transition hover:border-[#1556a4] hover:bg-[#eaf2fb] dark:hover:bg-[#102033]"
                    >
                      발행 페이지 보기
                    </a>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-4 rounded-[8px] border-2 border-dashed border-border bg-background p-4 text-sm text-muted-foreground">
              {isAuthenticated
                ? "아직 접수한 매거진 발행 요청이 없습니다."
                : "로그인 후 크레딧 사용 요청 내역을 확인할 수 있습니다."}
            </p>
          )}
        </section>
      </aside>
    </div>
  );
}
