import Link from "next/link";
import { requireAdminPage } from "@/lib/admin/page-auth";
import { ReviewDocsWorkspace } from "@/features/review-docs/review-docs-workspace";

export const metadata = { title: "심의자료 생성" };
export const dynamic = "force-dynamic";

export default async function ReviewDocsPage() {
  await requireAdminPage();
  return <main className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6">
    <Link href="/admin" className="text-sm font-semibold text-muted-foreground">← 관리자</Link>
    <h1 className="mt-3 font-display text-3xl font-black text-foreground">심의자료 생성</h1>
    <p className="mt-2 text-sm text-muted-foreground">자료를 분석하고 원문과 비교한 뒤 제출용 DOCX를 생성합니다.</p>
    <ReviewDocsWorkspace />
  </main>;
}
