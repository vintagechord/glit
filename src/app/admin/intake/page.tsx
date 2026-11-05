import Link from "next/link";

import { DirectIntakeForm } from "@/components/admin/direct-intake-form";
import { requireAdminPage } from "@/lib/admin/page-auth";

export const metadata = { title: "관리자 직접 접수" };
export const dynamic = "force-dynamic";

export default async function AdminDirectIntakePage() {
  await requireAdminPage();
  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6">
      <Link href="/admin" className="text-sm font-semibold text-muted-foreground hover:underline">
        ← 관리자 대시보드
      </Link>
      <h1 className="mt-3 font-display text-3xl font-black text-foreground">관리자 직접 접수</h1>
      <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-muted-foreground">
        사이트를 거치지 않고 이메일·메신저로 받은 음반 또는 뮤직비디오 심의 신청을 비회원 접수로 만듭니다.
        신청서(기준파일)를 분석해 항목을 채우고, 확인한 뒤 저장하면 고객용 결과 페이지와 조회 코드가 만들어집니다.
      </p>
      <DirectIntakeForm />
    </main>
  );
}
