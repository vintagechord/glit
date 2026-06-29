"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Info, SendHorizontal } from "lucide-react";

import { createMagazineRequestAction } from "./actions";

export type MagazineCreditOption = {
  id: string;
  title: string | null;
  artistName: string | null;
  releaseDate: string | null;
  createdAt: string | null;
  applicantName: string | null;
  applicantEmail: string | null;
  applicantPhone: string | null;
};

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
  creditOptions,
  existingRequests,
  availableCredits,
}: {
  isAuthenticated: boolean;
  userEmail?: string | null;
  creditOptions: MagazineCreditOption[];
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
  const [selectedSubmissionId, setSelectedSubmissionId] = React.useState(
    creditOptions[0]?.id ?? "",
  );

  const selectedCredit =
    creditOptions.find((option) => option.id === selectedSubmissionId) ??
    creditOptions[0] ??
    null;
  const canSubmit = isAuthenticated
    ? Boolean(selectedCredit) && availableCredits > 0
    : true;

  React.useEffect(() => {
    if (!selectedSubmissionId && creditOptions[0]?.id) {
      setSelectedSubmissionId(creditOptions[0].id);
    }
  }, [creditOptions, selectedSubmissionId]);

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);

    setNotice(null);
    startTransition(async () => {
      const submissionIdValue = String(
        formData.get("submissionId") ?? "",
      ).trim();
      const guestLookupCodeValue = String(
        formData.get("guestLookupCode") ?? "",
      ).trim();
      const result = await createMagazineRequestAction({
        submissionId:
          isAuthenticated && submissionIdValue ? submissionIdValue : undefined,
        guestLookupCode:
          !isAuthenticated && guestLookupCodeValue
            ? guestLookupCodeValue
            : undefined,
        targetChannel,
        requesterName: String(formData.get("requesterName") ?? ""),
        requesterEmail: String(formData.get("requesterEmail") ?? ""),
        requesterPhone: String(formData.get("requesterPhone") ?? ""),
        albumTitle: String(formData.get("albumTitle") ?? ""),
        artistName: String(formData.get("artistName") ?? ""),
        releaseDate: String(formData.get("releaseDate") ?? ""),
        artworkUrl: String(formData.get("artworkUrl") ?? ""),
        albumUrl: String(formData.get("albumUrl") ?? ""),
        videoUrl: String(formData.get("videoUrl") ?? ""),
        articleBody: String(formData.get("articleBody") ?? ""),
        creditsText: String(formData.get("creditsText") ?? ""),
        notes: String(formData.get("notes") ?? ""),
      });

      if (result.error) {
        setNotice({ type: "error", text: result.error });
        return;
      }

      form.reset();
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
      <section className="rounded-[10px] border-2 border-[#111111] bg-card p-5 shadow-[5px_5px_0_#111111] dark:border-[#f2cf27] dark:shadow-[5px_5px_0_#f2cf27] sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="bauhaus-kicker">Request</p>
            <h2 className="mt-3 text-2xl font-black text-foreground">
              매거진 발행 요청 폼
            </h2>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-[8px] border-2 border-[#111111] bg-[#f2cf27] px-3 py-1 text-[11px] font-black text-[#111111]">
            <Info className="h-3.5 w-3.5" aria-hidden="true" />
            1크레딧 사용
          </span>
        </div>

        <div className="mt-5 rounded-[8px] border-2 border-border bg-background/70 p-4 text-sm text-muted-foreground">
          <p className="flex gap-2 font-semibold text-foreground">
            <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            음반심의 결제 완료 1건당 매거진 발행 크레딧 1개가 제공됩니다.
          </p>
          <p className="mt-2 text-xs leading-5">
            회원은 로그인 후 보유 크레딧을 선택하고, 비회원은 접수 시 받은 조회
            코드로 결제 완료 건을 확인해 신청합니다.
          </p>
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

        <form onSubmit={handleSubmit} className="mt-6 space-y-6">
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
                        ? "border-[#111111] bg-[#f2cf27] text-[#111111] shadow-[4px_4px_0_#111111]"
                        : "border-border bg-background text-foreground hover:border-[#111111]"
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

          {isAuthenticated ? (
            <div className="grid gap-2">
              <label htmlFor="magazine-submission-id" className={labelClass}>
                매거진을 발행할 음반심의 건
              </label>
              <select
                id="magazine-submission-id"
                name="submissionId"
                value={selectedSubmissionId}
                onChange={(event) => setSelectedSubmissionId(event.target.value)}
                disabled={creditOptions.length === 0}
                className={fieldClass}
              >
                {creditOptions.length === 0 ? (
                  <option value="">사용 가능한 크레딧이 없습니다</option>
                ) : null}
                {creditOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {(option.artistName || "아티스트 미입력") +
                      " · " +
                      (option.title || "앨범명 미입력") +
                      (option.releaseDate
                        ? ` · 발매일 ${option.releaseDate}`
                        : "")}
                  </option>
                ))}
              </select>
              {selectedCredit ? (
                <p className="text-xs text-muted-foreground">
                  선택한 음반: {selectedCredit.artistName ?? "-"} ·{" "}
                  {selectedCredit.title ?? "-"}
                  {availableCredits <= 0
                    ? " · 사용 가능한 잔여 크레딧이 없습니다."
                    : ""}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  음반심의 결제 완료 후 이곳에서 무료 발행 크레딧을 사용할 수 있습니다.
                </p>
              )}
            </div>
          ) : (
            <div className="grid gap-2">
              <label htmlFor="guestLookupCode" className={labelClass}>
                비회원 조회 코드
              </label>
              <input
                id="guestLookupCode"
                name="guestLookupCode"
                placeholder="음반심의 접수 시 발급된 조회 코드"
                className={fieldClass}
              />
              <p className="text-xs text-muted-foreground">
                발매 후 매거진 발행 신청을 해도 괜찮습니다. 조회 코드로 결제 완료
                음반심의 건과 남은 크레딧을 확인합니다.
              </p>
            </div>
          )}

          <div
            key={selectedCredit?.id ?? "guest-request-fields"}
            className="grid gap-4 sm:grid-cols-2"
          >
            <label className="grid gap-2">
              <span className={labelClass}>담당자명</span>
              <input
                name="requesterName"
                required
                defaultValue={selectedCredit?.applicantName ?? ""}
                className={fieldClass}
              />
            </label>
            <label className="grid gap-2">
              <span className={labelClass}>이메일</span>
              <input
                name="requesterEmail"
                type="email"
                required
                defaultValue={selectedCredit?.applicantEmail ?? userEmail ?? ""}
                className={fieldClass}
              />
            </label>
            <label className="grid gap-2">
              <span className={labelClass}>연락처</span>
              <input
                name="requesterPhone"
                defaultValue={selectedCredit?.applicantPhone ?? ""}
                className={fieldClass}
              />
            </label>
            <label className="grid gap-2">
              <span className={labelClass}>발매일</span>
              <input
                name="releaseDate"
                type="date"
                defaultValue={selectedCredit?.releaseDate ?? ""}
                className={fieldClass}
              />
            </label>
            <label className="grid gap-2">
              <span className={labelClass}>앨범명</span>
              <input
                name="albumTitle"
                defaultValue={selectedCredit?.title ?? ""}
                placeholder="심의 신청 정보와 다르면 수정"
                className={fieldClass}
              />
            </label>
            <label className="grid gap-2">
              <span className={labelClass}>아티스트명</span>
              <input
                name="artistName"
                defaultValue={selectedCredit?.artistName ?? ""}
                className={fieldClass}
              />
            </label>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <label className="grid gap-2">
              <span className={labelClass}>아트워크 URL</span>
              <input
                name="artworkUrl"
                placeholder="https://..."
                className={fieldClass}
              />
            </label>
            <label className="grid gap-2">
              <span className={labelClass}>발매 앨범 링크</span>
              <input
                name="albumUrl"
                placeholder="멜론/유통 링크"
                className={fieldClass}
              />
            </label>
            <label className="grid gap-2">
              <span className={labelClass}>영상 링크</span>
              <input
                name="videoUrl"
                placeholder="MV/라이브/티저 링크"
                className={fieldClass}
              />
            </label>
          </div>

          <label className="grid gap-2">
            <span className={labelClass}>직접 작성한 매거진 기사 내용</span>
            <textarea
              name="articleBody"
              rows={6}
              placeholder="원하는 기사 톤, 소개 문장, 강조하고 싶은 포인트를 자유롭게 적어주세요."
              className={fieldClass}
            />
          </label>

          <label className="grid gap-2">
            <span className={labelClass}>크레딧 / 참여진</span>
            <textarea
              name="creditsText"
              rows={4}
              placeholder="작사, 작곡, 편곡, 프로듀서, 연주자, 출연진 등"
              className={fieldClass}
            />
          </label>

          <label className="grid gap-2">
            <span className={labelClass}>기타 요청사항</span>
            <textarea
              name="notes"
              rows={4}
              placeholder="발행 희망일, 참고 링크, 언론자료 메모 등"
              className={fieldClass}
            />
          </label>

          <button
            type="submit"
            disabled={isPending || !canSubmit}
            className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-[8px] border-2 border-[#111111] bg-[#111111] px-5 py-3 text-sm font-black text-white shadow-[4px_4px_0_#f2cf27] transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:border-border disabled:bg-muted disabled:text-muted-foreground disabled:shadow-none"
          >
            <SendHorizontal className="h-4 w-4" aria-hidden="true" />
            {isPending ? "요청 접수 중..." : "크레딧 사용해서 발행 요청"}
          </button>
        </form>
      </section>

      <aside className="space-y-5">
        <section className="rounded-[10px] border-2 border-[#111111] bg-background p-5 dark:border-[#f2cf27]">
          <p className="bauhaus-kicker">Credits</p>
          <h2 className="mt-3 text-xl font-black text-foreground">
            내 매거진 크레딧
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
            크레딧은 결제 완료된 음반심의 접수 1건마다 1개로 계산됩니다.
            매거진 발행 1회 또는 서비스 이용권 교환에 사용한 크레딧은 잔여
            수량에서 차감됩니다.
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
                      {request.albumTitle ?? "앨범명 미입력"}
                    </p>
                    <span className="rounded-[6px] bg-[#f2cf27] px-2 py-1 text-[10px] font-black text-[#111111]">
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
                      className="mt-3 inline-flex rounded-[8px] border-2 border-[#111111] px-3 py-2 text-xs font-black text-foreground transition hover:bg-[#f2cf27]"
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
                : "비회원 요청 내역은 조회 코드로 개별 확인됩니다."}
            </p>
          )}
        </section>
      </aside>
    </div>
  );
}
