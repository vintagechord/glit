export const metadata = {
  title: "Admin",
};

export default function AdminPage() {
  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-12">
      <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
        Admin
      </p>
      <h1 className="font-display mt-2 text-3xl text-foreground">
        관리자 대시보드 준비 중
      </h1>
      <p className="mt-3 text-sm text-muted-foreground">
        접수 리스트, 결제 승인, 방송국별 상태 관리 화면이 Phase 4에서
        추가됩니다.
      </p>
    </div>
  );
}
