export function AccountPageLoading({ english = false }: { english?: boolean }) {
  return (
    <div role="status" aria-busy="true" className="mx-auto w-full max-w-6xl space-y-6 px-4 py-8 sm:px-6 sm:py-12">
      <p className="text-sm font-semibold text-muted-foreground">
        {english ? "Loading your information…" : "정보를 불러오고 있습니다."}
      </p>
      <div aria-hidden="true" className="space-y-6 motion-safe:animate-pulse">
        <div className="h-9 w-48 rounded-[8px] bg-muted" />
        <div className="flex gap-3 border-b border-border pb-4">
          {[0, 1, 2].map(item => <div key={item} className="h-10 w-24 rounded-[8px] bg-muted" />)}
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          {[0, 1].map(item => <div key={item} className="h-48 rounded-[10px] border-2 border-border bg-card" />)}
        </div>
      </div>
    </div>
  );
}
