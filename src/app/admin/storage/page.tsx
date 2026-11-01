import Link from "next/link";

import {
  CustomerFilePurgePanel,
  type PurgeListItem,
} from "@/components/admin/customer-file-purge-panel";
import { loadPurgeCandidates } from "@/lib/admin/customer-file-purge";
import { requireAdminPage } from "@/lib/admin/page-auth";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata = { title: "저장공간 정리" };
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const buttonClass =
  "inline-flex min-h-10 items-center justify-center rounded-[8px] border-2 border-[var(--bauhaus-ink)] bg-background px-3 text-xs font-black text-foreground shadow-[2px_2px_0_#111111] transition hover:-translate-y-0.5";

export default async function AdminStoragePage() {
  await requireAdminPage();
  let items: PurgeListItem[] = [];
  let loadError: string | null = null;
  try {
    // Object keys stay on the server; the browser only sees what it lists.
    items = (await loadPurgeCandidates(createAdminClient())).map((candidate) => ({
      submissionId: candidate.submissionId,
      title: candidate.title,
      artistName: candidate.artistName,
      type: candidate.type,
      refunded: candidate.refunded,
      finishedAt: candidate.finishedAt,
      fileCount: candidate.files.length,
      totalBytes: candidate.totalBytes,
    }));
  } catch (error) {
    console.error("[admin][storage] candidate load failed", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    loadError = "삭제 대상을 불러오지 못했습니다. 잠시 후 새로고침해주세요.";
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-black tracking-[0.2em] text-muted-foreground">STORAGE</p>
          <h1 className="mt-2 text-3xl font-black text-foreground">저장공간 정리</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            심의가 끝났거나 환불된 신청에서 고객이 올린 파일만 저장소(B2)에서 영구 삭제해 용량을 확보합니다.
          </p>
        </div>
        <Link href="/admin" className={buttonClass}>관리자 홈</Link>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-[10px] border-2 border-[var(--bauhaus-ink)] bg-[var(--bauhaus-red)] p-4 text-sm leading-6 text-white">
          <p className="font-black">삭제되는 파일</p>
          <p className="mt-1">고객이 올린 음원·영상·가사·신청서·기타 파일과 보완 제출 파일. 파일의 모든 버전까지 지워 실제 용량이 줄어듭니다. 되돌릴 수 없습니다.</p>
        </div>
        <div className="rounded-[10px] border-2 border-[var(--bauhaus-ink)] bg-[var(--bauhaus-blue)] p-4 text-sm leading-6 text-white">
          <p className="font-black">유지되는 것</p>
          <p className="mt-1">영등위 필증, 연령등급 이미지, 표기 가이드, 결과 메일 기록, 신청·결제·심의 결과 내역과 파일 이름 목록. 고객 화면에는 &ldquo;보관 종료로 삭제됨&rdquo;으로 표시됩니다.</p>
        </div>
      </div>

      <div className="rounded-[10px] border-2 border-[var(--bauhaus-ink)] bg-[var(--bauhaus-yellow)] p-4 text-sm leading-6 text-[#111111]">
        목록에는 결과가 모두 나온 결제 완료 신청과 환불된 신청만 나옵니다. 방송국 결과가 하나라도 남았거나 보완 요청이 진행 중인 신청, 결과 등급이 공개되지 않은 온라인 뮤직비디오는 나오지 않습니다.
      </div>

      {loadError ? (
        <div role="alert" className="rounded-[10px] border-2 border-[var(--bauhaus-ink)] bg-[var(--bauhaus-red)] p-4 text-sm font-semibold text-white">
          {loadError}
        </div>
      ) : (
        <CustomerFilePurgePanel items={items} />
      )}
    </div>
  );
}
