import Link from "next/link";
import { requireAdminPage } from "@/lib/admin/page-auth";
import { MusicArchiveAdminClient } from "@/features/music-archive/admin-client";

export const metadata = { title: "음악 관리 운영" };
export const dynamic = "force-dynamic";

export default async function MusicArchiveAdminPage() {
  await requireAdminPage();
  return <main className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6">
    <Link href="/admin" className="text-sm font-semibold text-muted-foreground">← 관리자</Link>
    <h1 className="mt-3 font-display text-3xl font-black text-foreground">음악 관리 운영</h1>
    <p className="mt-2 text-sm leading-6 text-muted-foreground">제공처 수집 오류를 확인하고 회원에게 표시할 공식 절차와 링크를 관리합니다.</p>
    <MusicArchiveAdminClient />
  </main>;
}
