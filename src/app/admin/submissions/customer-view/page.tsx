import Link from "next/link";

import { SubmissionDetailClient } from "@/features/submissions/submission-detail-client";
import { requireAdminPage } from "@/lib/admin/page-auth";
import { brandStatusTones } from "@/lib/brand-status-tones";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadCustomerSubmissionDetail } from "@/lib/submissions/customer-detail";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata = {
  title: "고객 결과 페이지 미리보기",
  robots: { index: false, follow: false },
};

const uuidPattern = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/** The customer's result page as the customer sees it (member view, or the
 * guest lookup view for guest submissions), rendered for an administrator.
 * Read-only data; the customer's own page stays the source of truth. */
export default async function AdminCustomerViewPage({
  searchParams,
}: {
  searchParams?: Promise<{ id?: string | string[] }>;
}) {
  await requireAdminPage();
  const resolved = (await searchParams) ?? {};
  const rawId = Array.isArray(resolved.id) ? resolved.id[0] : resolved.id;
  const submissionId = rawId && uuidPattern.test(rawId.trim()) ? rawId.trim() : "";
  const detail = submissionId
    ? await loadCustomerSubmissionDetail(createAdminClient(), { submissionId }, {
        onError: (name, error) => console.error(`[AdminCustomerView] ${name} load failed`, error),
      })
    : null;

  if (!detail) {
    return (
      <div className="mx-auto w-full max-w-3xl px-6 py-12">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">Customer view</p>
        <h1 className="font-display mt-2 text-2xl text-foreground">고객 결과 페이지를 불러올 수 없습니다.</h1>
        <p className={`mt-4 rounded-2xl border-2 px-4 py-3 text-sm font-semibold ${brandStatusTones.danger}`}>
          접수 ID를 확인해주세요. 삭제된 접수이거나 주소가 잘못되었을 수 있습니다.
        </p>
        <Link href="/admin/submissions" className="mt-4 inline-block rounded-full border border-border/70 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-foreground transition hover:border-foreground">
          접수 목록으로
        </Link>
      </div>
    );
  }

  const isGuest = !detail.userId && Boolean(detail.guestToken);
  const adminDetailHref = `/admin/submissions/detail?id=${encodeURIComponent(submissionId)}`;

  return (
    <div>
      <div className="mx-auto mb-2 flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 rounded-[8px] border-2 border-[#111111] bg-[#f2cf27] px-4 py-3 text-sm text-[#111111]">
        <p className="font-black">
          관리자 미리보기 · 고객에게 보이는 결과 페이지입니다.
          <span className="ml-2 font-semibold">{isGuest ? "비회원 조회 링크 화면 기준" : "회원 로그인 화면 기준"}</span>
        </p>
        <Link href={adminDetailHref} className="rounded-[6px] border-2 border-[#111111] bg-white px-3 py-1 text-xs font-black text-[#111111] transition hover:bg-[#111111] hover:text-white">
          접수 상세 관리로 돌아가기
        </Link>
      </div>
      <SubmissionDetailClient
        submissionId={submissionId}
        initialSubmission={detail.submission}
        initialStationReviews={detail.stationReviews}
        initialFiles={detail.files}
        enableRealtime={false}
        guestToken={isGuest ? detail.guestToken ?? undefined : undefined}
      />
    </div>
  );
}
