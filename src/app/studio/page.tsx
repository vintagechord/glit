export const metadata = {
  title: "Studio",
};

export default function StudioPage() {
  return (
    <div className="page-centered mx-auto w-full max-w-5xl px-6 py-12">
      <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
        Studio
      </p>
      <h1 className="font-display mt-2 text-3xl text-foreground">
        Studio 서비스 준비 중
      </h1>
      <p className="mt-3 text-sm text-muted-foreground">
        심의 접수 외 확장 서비스는 곧 제공될 예정입니다.
      </p>
    </div>
  );
}
