export default function MvSubmissionLoading() {
  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-12">
      <div className="rounded-[10px] border-2 border-[#111111] bg-card p-6 shadow-[8px_8px_0_#111111] dark:border-[#f2cf27] dark:shadow-[8px_8px_0_#f2cf27] sm:p-8">
        <p className="bauhaus-kicker">뮤직비디오 심의 신청</p>
        <div className="mt-6 h-8 w-2/3 animate-pulse rounded bg-muted" />
        <div className="mt-4 h-4 w-1/2 animate-pulse rounded bg-muted" />
        <div className="mt-8 grid gap-4 md:grid-cols-2">
          {[0, 1].map((item) => (
            <div
              key={item}
              className="h-40 animate-pulse rounded-[8px] border-2 border-border bg-background"
            />
          ))}
        </div>
      </div>
    </div>
  );
}
