export function ReviewPageLoading({ english = false }: { english?: boolean }) {
  return (
    <div
      role="status"
      aria-busy="true"
      className="mx-auto w-full max-w-6xl space-y-5 px-4 py-6 sm:px-6 sm:py-9"
    >
      <p className="text-sm font-semibold text-muted-foreground">
        {english ? "Loading your review details…" : "심의 정보를 불러오고 있습니다."}
      </p>
      <div aria-hidden="true" className="space-y-4 motion-safe:animate-pulse">
        <div className="h-9 w-48 rounded-[8px] bg-muted" />
        {[0, 1, 2].map((row) => (
          <div key={row} className="space-y-4 rounded-[8px] border-2 border-border p-5">
            <div className="h-6 w-2/5 rounded bg-muted" />
            <div className="h-4 w-3/5 rounded bg-muted" />
            <div className="h-11 w-full rounded bg-muted" />
          </div>
        ))}
      </div>
    </div>
  );
}
