export default function PageLoading() {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 sm:py-12" role="status" aria-live="polite">
      <p className="text-sm font-semibold text-muted-foreground">불러오는 중</p>
      <div aria-hidden="true" className="mt-5 space-y-5 motion-safe:animate-pulse">
        <div className="h-9 w-2/3 max-w-md rounded-[8px] bg-muted" />
        <div className="h-4 w-1/2 max-w-sm rounded-[8px] bg-muted" />
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="h-44 rounded-[10px] border-2 border-border bg-card" />
          <div className="h-44 rounded-[10px] border-2 border-border bg-card" />
        </div>
      </div>
    </div>
  );
}
