export const metadata = {
  title: "Studio",
};

export default function StudioPage() {
  return (
    <div className="page-centered mx-auto w-full max-w-5xl px-6 py-12">
      <div className="relative overflow-hidden rounded-[10px] border-2 border-[#111111] bg-card p-8 shadow-[8px_8px_0_#111111] dark:border-[#f2cf27] dark:shadow-[8px_8px_0_#f2cf27]">
        <div aria-hidden="true" className="absolute right-0 top-0 h-14 w-14 bg-[#f2cf27]" />
        <p className="bauhaus-kicker">Studio</p>
        <h1 className="font-display mt-4 text-3xl font-black text-foreground">
          Studio 서비스 준비 중
        </h1>
        <p className="mt-3 text-sm font-semibold text-muted-foreground">
          심의 접수 외 확장 서비스는 곧 제공될 예정입니다.
        </p>
      </div>
    </div>
  );
}
