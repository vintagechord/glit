"use client";

export default function AlbumSubmissionError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-12">
      <div className="rounded-[10px] border-2 border-[#111111] bg-card p-6 shadow-[8px_8px_0_#111111] dark:border-[#f2cf27] dark:shadow-[8px_8px_0_#f2cf27]">
        <p className="bauhaus-kicker">음반 심의 신청</p>
        <h1 className="mt-4 text-2xl font-black text-foreground">
          신청 페이지를 불러오지 못했습니다
        </h1>
        <p className="mt-3 text-sm font-semibold leading-6 text-muted-foreground">
          네트워크 또는 서버 응답 지연이 발생했습니다. 다시 시도해도 열리지 않으면 고객센터로 문의해주세요.
        </p>
        <button type="button" onClick={reset} className="bauhaus-button mt-6 px-5 py-3 text-sm">
          다시 불러오기
        </button>
      </div>
    </div>
  );
}
